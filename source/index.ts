import * as fs from 'fs';
import * as path from 'path';
import mkdirp from 'mkdirp';
import * as ts from 'typescript';

function main(inputDir: string, outputDir: string) {
    let rootDir = inputDir;

    let forEachFile = (dir: string, extension: string, fx: (file: string) => void) => {
        let entries = fs.readdirSync(dir);
        for (let entry of entries) {
            entry = path.resolve(dir, entry);
            let stat = fs.statSync(entry);
            if (stat && stat.isDirectory()) {
                forEachFile(entry, extension, fx);
            } else if (entry.endsWith(extension)) {
                fx(path.relative(rootDir, entry));
            }
        }
    };

    let files: string[] = [];
    forEachFile(inputDir, ".js", (file) => {
        let input = path.resolve(inputDir, file);
        let output = path.resolve(outputDir, file);
        output = output.replace(".js", ".ts");
        let outputParentDir = path.dirname(output);
        mkdirp.sync(outputParentDir);
        files.push(output);
        fs.copyFileSync(input, output);
    });

    let program = ts.createProgram(files, {});
    let typeChecker = program.getTypeChecker();

    let printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed
    });

    for (let file of files) {
        let sourceFile = program.getSourceFile(file);
        if (!sourceFile) {
            console.log(`Cannot get source file for ${file}`);
            continue;
        }

        console.log(`\n==== ${path.relative(outputDir, sourceFile.fileName)} ====\n`);

        console.log(`* Extract schema`);
        _extractSchema(sourceFile, typeChecker);

        console.log("");

        console.log(`* Inject old style class member`);
        _injectOldStyleClassMember(sourceFile, typeChecker);

        console.log("");

        //console.log(`* Explicit any\n`);
        _explicitAny(sourceFile);

        console.log(`* Inject properties`);
        _injectProperties(sourceFile, typeChecker);

        fs.writeFileSync(sourceFile.fileName, printer.printFile(sourceFile));
    }
}

function _forEach(node: ts.Node, fx: (node: ts.Node) => void) {
    fx(node);
    ts.forEachChild(node, (childNode) => {
        _forEach(childNode, fx);
    });
}

function _explicitAny(sourceFile: ts.SourceFile) {
    let isForInVarDecl = (node: ts.Node) => {
        return (node.parent && node.parent.parent && ts.isForInStatement(node.parent.parent));
    };
    let isCatchVarDecl = (node: ts.Node) => {
        return (node.parent && ts.isCatchClause(node.parent));
    };
    _forEach(sourceFile, (node) => {
        if (ts.isParameter(node) ||
            (ts.isVariableDeclaration(node) && !isForInVarDecl(node) && !isCatchVarDecl(node))) {
            if (!node.type) {
                node.type = ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
            }
        }
    });
}

function _extractSchema(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    let isSchemaExpr = (node: ts.Node) =>
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind == ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text == "schema" &&
        ts.isObjectLiteralExpression(node.right);

    _forEach(sourceFile, (node) => {
        if (!isSchemaExpr(node)) {
            return;
        }

        let processSchemaMember = (name: string, member: ts.ObjectLiteralExpression): { getter: ts.ClassElement | undefined, setter: ts.ClassElement | undefined } => {
            let getterBody: ts.Block | undefined = undefined;
            let setterBody: ts.Block | undefined = undefined;
            let setterParam: ts.NodeArray<ts.ParameterDeclaration> | undefined = undefined;

            for (let prop of member.properties) {
                if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
                    if (prop.name.text == "get") {
                        getterBody = prop.body;
                    } else if (prop.name.text == "set") {
                        setterBody = prop.body;
                        setterParam = prop.parameters;
                    }
                } else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                    if (prop.name.text == "type") {
                    } else if (prop.name.text == "default") {
                    }
                }
            }

            if (!getterBody) {
                getterBody = ts.createBlock([ts.createReturn(
                    ts.createPropertyAccess(ts.createThis(), `_${name}`)
                )], true);
            }
            let getter = ts.createGetAccessor(
                undefined,
                undefined,
                name,
                [],
                ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                getterBody
            );

            if (!setterParam) {
                setterParam = ts.createNodeArray([ts.createParameter(
                    undefined,
                    undefined,
                    undefined,
                    "value",
                    undefined,
                    ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    undefined
                )]);
            }
            if (!setterBody) {
                setterBody = ts.createBlock([ts.createExpressionStatement(
                    ts.createAssignment(
                        ts.createPropertyAccess(ts.createThis(), `_${name}`),
                        ts.createIdentifier("value")
                    )
                )], true);
            }
            let setter = ts.createSetAccessor(
                undefined,
                undefined,
                name,
                setterParam,
                setterBody
            );

            return { getter, setter };
        };

        let schemaExpr = node as ts.BinaryExpression;
        let hostClassExpr = (schemaExpr.left as ts.PropertyAccessExpression).expression;
        let schemaBody = schemaExpr.right as ts.ObjectLiteralExpression;

        console.log(`${hostClassExpr.getText()}`);
        let hostClass = typeChecker.getSymbolAtLocation(hostClassExpr);
        if (!hostClass || !hostClass.valueDeclaration) {
            // WARNING
        } else {
            let hostClassDecl = hostClass.valueDeclaration;
            if (!ts.isClassDeclaration(hostClassDecl)) {
                // WARNING
            } else {
                let members: ts.ClassElement[] = [];
                for (let property of schemaBody.properties) {
                    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
                        if (ts.isObjectLiteralExpression(property.initializer)) {
                            let accessor = processSchemaMember(property.name.text, property.initializer);
                            if (accessor.getter) {
                                members.push(accessor.getter);
                            }
                            if (accessor.setter) {
                                members.push(accessor.setter);
                            }
                        }
                    }
                }
                _addClassMembers(members, hostClassDecl);
            }
        }

        if (schemaExpr.parent &&
            schemaExpr.parent.parent &&
            ts.isExpressionStatement(schemaExpr.parent) &&
            ts.isSourceFile(schemaExpr.parent.parent)) {
            _removeStmtFromSourceFile(schemaExpr.parent, schemaExpr.parent.parent);
        }
    });
}

function _injectOldStyleClassMember(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    _forEach(sourceFile, (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
            let members = [];
            if (node.parent && ts.isSourceFile(node.parent)) {
                for (let stmt of node.parent.statements) {
                    if (ts.isExpressionStatement(stmt) &&
                        ts.isBinaryExpression(stmt.expression) &&
                        stmt.expression.operatorToken.kind  == ts.SyntaxKind.EqualsToken &&
                        ts.isPropertyAccessExpression(stmt.expression.left)) {
                        let cls = typeChecker.getSymbolAtLocation(stmt.expression.left.expression);
                        if (cls && cls.valueDeclaration == node) {
                            if (node.name) {
                                console.log(`Old-style ${node.name.text}.${stmt.expression.left.name.text}`);
                                members.push(ts.createProperty(
                                    undefined,
                                    [ts.createModifier(ts.SyntaxKind.StaticKeyword)],
                                    stmt.expression.left.name.text,
                                    undefined,
                                    ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                                    stmt.expression.right
                                ));
                                _removeStmtFromSourceFile(stmt, node.parent);
                            }
                        }
                    }
                }
            }
            _addClassMembers(members, node);
        }
    });
}

function _injectProperties(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    _forEach(sourceFile, (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
            _injectPropertiesOneClass(node as ts.ClassDeclaration, typeChecker);
        }
    });
}

function _addClassMembers(members: ts.ClassElement[], classDeclaration: ts.ClassDeclaration) {
    if (members.length > 0) {
        classDeclaration.members = ts.createNodeArray(classDeclaration.members.concat(members));
    }
}

function _removeStmtFromSourceFile(statement: ts.Statement, sourceFile: ts.SourceFile) {
    let i = sourceFile.statements.indexOf(statement);
    if (i < 0) {
        return;
    }
    sourceFile.statements = ts.createNodeArray(
        sourceFile.statements.slice(0, i).concat(sourceFile.statements.slice(i + 1)));
}

function _injectPropertiesOneClass(classDeclaration: ts.ClassDeclaration, typeChecker: ts.TypeChecker) {
    let nonPropertyMembers = new Set<string>();

    let collectNonPropertyMembers = (classDecl: ts.ClassDeclaration) => {
        for (let member of classDeclaration.members) {
            if (member.name as ts.Identifier) {
                nonPropertyMembers.add((member.name as ts.Identifier).text);
            }
        }

        if (classDecl.heritageClauses) {
            for (let heri of classDecl.heritageClauses) {
                if (heri.token == ts.SyntaxKind.ExtendsKeyword) {
                    for (let type of heri.types) {
                        let base = typeChecker.getSymbolAtLocation(type.expression);
                        if (base && base.valueDeclaration) {
                            if (ts.isClassDeclaration(base.valueDeclaration)) {
                                collectNonPropertyMembers(base.valueDeclaration);
                            }
                        } else {
                            // DO IT: warnning?
                        }
                    }
                }
            }
        }
    };

    collectNonPropertyMembers(classDeclaration);

    let thisMembers = new Set<string>();
    _forEach(classDeclaration, (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node)) {
            if (node.expression.kind == ts.SyntaxKind.ThisKeyword) {
                thisMembers.add(node.name.text);
            }
        }
    });

    let properties = [];
    let ps = [];
    for (let thisMember of thisMembers) {
        if (!nonPropertyMembers.has(thisMember)) {
            ps.push(thisMember);
            properties.push(ts.createProperty(
                undefined,
                undefined,
                thisMember,
                undefined,
                ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                undefined
            ));
        }
    }
    classDeclaration.members = ts.createNodeArray(
        classDeclaration.members.concat(properties));

    if (properties.length != 0)
        console.log(`${classDeclaration.name ? classDeclaration.name.text : "<unnamed-class>"} - ${ps}`);
}

main(String.raw`.\testcases\engine-3d\lib`, String.raw`.\out\engine-3d\lib`);