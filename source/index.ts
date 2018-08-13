import * as fs from 'fs';
import * as path from 'path';
import mkdirp from 'mkdirp';
import * as ts from 'typescript';

function main(inputDir: string, outputDir: string, ...excludePaths: string[]) {
    let excludes: string[] = [];
    excludePaths.forEach((p) => {
        excludes.push(path.join(inputDir, p));
    });
    let isExcluded = (p: string) => {
        for (let ep of excludes) {
            if (p.startsWith(ep)) {
                return true;
            }
        }
        return false;
    };

    let rootDir = inputDir;

    let forEachFile = (dir: string, extension: string, fx: (file: string) => void) => {
        let entries = fs.readdirSync(dir);
        for (let entry of entries) {
            entry = path.resolve(dir, entry);
            if (isExcluded(entry)) {
                continue;
            }
            let stat = fs.statSync(entry);
            if (stat && stat.isDirectory()) {
                forEachFile(entry, extension, fx);
            } else if (entry.endsWith(extension)) {
                fx(path.relative(rootDir, entry));
            }
        }
    };

    let files: string[] = [];
    let copyAsTs = (file: string) => {
        let input = path.resolve(inputDir, file);
        let output = path.resolve(outputDir, file);
        output = output.replace(".js", ".ts");
        let outputParentDir = path.dirname(output);
        mkdirp.sync(outputParentDir);
        files.push(output);
        fs.copyFileSync(input, output);
    }

    forEachFile(inputDir, ".js", copyAsTs);

    let printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed
    });

    let passes = [
        [
            { name: "Extract schema", method: _extractSchema },
            { name: "Inject old-style class member", method: _injectOldStyleClassMember },
            { name: "Inject properties", method: _injectProperties }
        ],
        [
            { name: "Inject apperant type", method: _injectApperantType },
            { name: "Make explicit any", method: _explicitAny }
        ],
        [
            { name: "Context this", method: _contextThis },
            { name: "This index signature", method: _thisSignature },
            { name: "Document & Window", method: _documentWindow },
            { name: "Boolean Computed Property Name", method: _booleanComputedPropertyName },
        ],
        [
            { name: "Supply Args", method: _supplyArgs }
        ]
    ];

    let logDir = 'logs';
    mkdirp.sync(logDir);
    for (let pass of passes) {
        for (let task of pass) {
            (task as any)._stream = fs.openSync(`logs/${task.name}.txt`, 'w');
        }
    }

    for (let pass of passes) {
        let program = ts.createProgram(files, {});
        let typeChecker = program.getTypeChecker();
        for (let file of files) {
            let sourceFile = program.getSourceFile(file);
            if (!sourceFile) {
                console.log(`Cannot get source file for ${file}`);
                continue;
            }

            for (let task of pass) {
                let oldStdout = console.log;

                let fd = (task as any)._stream as number;
                let inited = false;
                console.log = (str: string) => {
                    if (!inited) {
                        inited = true;
                        if (sourceFile) {
                            console.log(`\n* ${path.relative(outputDir, sourceFile.fileName)}\n`);
                        }
                    }
                    fs.writeSync(fd, str);
                    fs.writeSync(fd, `\n`);
                };

                task.method(sourceFile, typeChecker);

                console.log = oldStdout;
            }

            fs.writeFileSync(sourceFile.fileName, printer.printFile(sourceFile));
        }
    }

    for (let pass of passes) {
        for (let task of pass) {
            fs.closeSync((task as any)._stream as number);
        }
    }
}

function _forEach(node: ts.Node, fx: (node: ts.Node) => void) {
    fx(node);
    ts.forEachChild(node, (childNode) => {
        _forEach(childNode, fx);
    });
}

function _injectApperantType(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    _forEach(sourceFile, (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
            if (node.name && node.name.text == "vec3") {
                for (let member of node.members) {
                    if (ts.isMethodDeclaration(member)) {
                        continue;
                    }
                    if (member.name) {
                        let symbol = typeChecker.getSymbolAtLocation(member.name);
                        let type = typeChecker.getTypeAtLocation(member.name);
                        let apperantType = typeChecker.getApparentType(type);
                        let widenedType = typeChecker.getWidenedType(type);

                        if (apperantType.isNumberLiteral()) {
                            continue;
                        }
                    }
                }
            }
        }
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
            if (ts.isParameter(node) && node.dotDotDotToken) {
                console.log(`Found rest parameter "${(node.name as ts.Identifier).text}", make it as any[].`);
                if (!node.type) {
                    node.type = ts.createArrayTypeNode(_createAnyTypeNode());
                }
            } else {
                if (node.initializer &&
                    (ts.isNumericLiteral(node.initializer) ||
                        ts.isStringLiteral(node.initializer) ||
                        node.initializer.kind == ts.SyntaxKind.TrueKeyword ||
                        node.initializer.kind == ts.SyntaxKind.FalseKeyword)) {
                    // if (ts.isIdentifier(node.name)) {
                    //     console.log(`Skip ${node.name.text}`);
                    // }
                    return;
                }
                if (!node.type) {
                    node.type = _createAnyTypeNode();
                }
            }
        }
    });
}

function _createAnyTypeNode() {
    return ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
}

function _documentWindow(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    let forbidMap = new Map<string, string[]>();
    forbidMap.set("document", ["mozPointerLockElement"]);
    forbidMap.set("window", [
        "XMLHttpRequest",
        "ActiveXObject",

        "AudioContext",
        "webkitAudioContext",
        "mozAudioContext",
    ]);
    _forEach(sourceFile, (node) => {
        if (ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression)) {
            let li = forbidMap.get(node.expression.text);
            if (li) {
                if (li.indexOf(node.name.text) >= 0) {
                    console.log(`Process ${node.expression.text}.${node.name.text}`);
                    node.expression = ts.createPropertyAccess(
                        ts.createAsExpression(node.expression, _createAnyTypeNode()), node.name).expression;
                }
            }
        }
    });
}

function _thisSignature(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    _forEach(sourceFile, (node) => {
        if (ts.isElementAccessExpression(node) &&
            node.expression.kind == ts.SyntaxKind.ThisKeyword) {

            {
                let n: ts.Node = node;
                while (n && !ts.isSourceFile(n)) {
                    if (ts.isFunctionDeclaration(n)) {
                        console.log(`Skip this[] in function expression`);
                        return;
                    } else if (ts.isMethodDeclaration(n)) {
                        break;
                    }
                    n = n.parent;
                }
            }

            console.log(`Process this[${node.argumentExpression.getText()}]`);
            node.expression = ts.createElementAccess(
                ts.createAsExpression(node.expression, _createAnyTypeNode()), node.argumentExpression).expression;
        }
    });
}

function _contextThis(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    // DO IT: SKIP THIS OF ENCLOSING CLASS EXPRESSION
    _forEach(sourceFile, (funcexpr) => {
        if (ts.isFunctionExpression(funcexpr)) {
            let found = false;
            _forEach(funcexpr, (node) => {
                if (node.kind == ts.SyntaxKind.ThisKeyword) {
                    found = true;
                }
            });
            if (found) {
                console.log(`Found context this.`);
                let thisParam = ts.createParameter(
                    undefined,
                    undefined,
                    undefined,
                    "this",
                    undefined,
                    _createAnyTypeNode(),
                    undefined
                );
                let newParams = [thisParam].concat(funcexpr.parameters.slice());
                funcexpr.parameters = ts.createNodeArray(newParams);
            }
        }
    });
}

function _booleanComputedPropertyName(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    _forEach(sourceFile, (node) => {
        if (ts.isObjectLiteralExpression(node)) {
            for (let property of node.properties) {
                if (property.name && ts.isComputedPropertyName(property.name)) {
                    let expr = property.name.expression;
                    if (expr.kind == ts.SyntaxKind.TrueKeyword ||
                        expr.kind == ts.SyntaxKind.FalseKeyword) {
                        console.log("Found computed property name of boolean literal");
                        property.name.expression = ts.createStringLiteral(expr.kind == ts.SyntaxKind.TrueKeyword ? "true" : "false");
                    }
                }
            }
        }
    });
}

function _supplyArgs(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker) {
    //let need = false;
    //let undefinedID = "__SPY_UNDEFINED__";
    _forEach(sourceFile, (node) => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            let params: ts.NodeArray<ts.ParameterDeclaration> | undefined = undefined;
            let functype = typeChecker.getTypeAtLocation(node.expression);
            if (functype) {
                if (functype.symbol) {
                    let fundecl = functype.symbol.valueDeclaration;
                    if (fundecl) {
                        if (ts.isFunctionDeclaration(fundecl) ||
                            ts.isMethodDeclaration(fundecl)) {
                            params = fundecl.parameters;
                        } else if (ts.isClassDeclaration(fundecl)) {
                            for (let member of fundecl.members) {
                                if (ts.isConstructorDeclaration(member)) {
                                    params = member.parameters;
                                }
                            }
                        }
                    }
                }
            }

            if (params) {
                let args: ts.NodeArray<ts.Expression> | undefined = undefined;
                if (ts.isNewExpression(node)) {
                    args = node.arguments;
                } else {
                    args = node.arguments;
                }

                let nExpectedArgs = 0;
                for (let i = params.length - 1; i >= 0; --i) {
                    if (!params[i].initializer && !params[i].questionToken) {
                        nExpectedArgs = i + 1;
                        break;
                    }
                }

                if (nExpectedArgs == 0 && !args) {
                    return;
                }

                let nNewArgs = nExpectedArgs - (args ? args.length : 0);
                if (nNewArgs > 0) {
                    //need = true;
                    if (!args) {
                        args = ts.createNodeArray();
                    }

                    let newArgs = new Array(nNewArgs);
                    for (let i = 0; i < newArgs.length; ++i) {
                        newArgs[i] = ts.parseIsolatedEntityName("undefined", ts.ScriptTarget.Latest);
                        newArgs[i].parent = ts.createStringLiteral("");
                    }
                    args = ts.createNodeArray(args.slice().concat(newArgs));

                    if (ts.isNewExpression(node)) {
                        node.arguments = ts.createNew(node.expression, node.typeArguments, args).arguments;
                    } else {
                        node.arguments = ts.createCall(node.expression, node.typeArguments, args).arguments;
                    }

                    console.log(`Found: ${node.getText()} lack of ${newArgs.length} arguments.`);
                }
            }
        }
    });

    // if (need) {
    //     sourceFile.statements = ts.createNodeArray(
    //         sourceFile.statements.slice().concat([
    //             ts.createVariableStatement(
    //                 undefined,
    //                 [ts.createVariableDeclaration(
    //                     undefinedID,
    //                     ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
    //                     undefined)])
    //         ]));
    // }
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

            let newProps = [];
            for (let prop of member.properties) {
                let isgetset = false;
                if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
                    if (prop.name.text == "get") {
                        getterBody = prop.body;
                        isgetset = true;
                    } else if (prop.name.text == "set") {
                        setterBody = prop.body;
                        setterParam = prop.parameters;
                        isgetset = true;
                    }
                } else if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                    if (prop.name.text == "type") {
                    } else if (prop.name.text == "default") {
                    }
                }
                if (!isgetset) {
                    newProps.push(prop);
                }
            }

            member.properties = ts.createNodeArray(newProps);

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
        let hostClassDecl = _getValueDeclaration(hostClassExpr, typeChecker);
        if (!hostClassDecl) {
            console.log(`Warning: Cannot find value declaration of this schema's host class.`);
        } else {
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

        //schemaExpr.left = ts.createAsExpression(schemaExpr.left, _createAnyTypeNode());

        // if (schemaExpr.parent &&
        //     schemaExpr.parent.parent &&
        //     ts.isExpressionStatement(schemaExpr.parent) &&
        //     ts.isSourceFile(schemaExpr.parent.parent)) {
        //     _removeStmtFromSourceFile(schemaExpr.parent, schemaExpr.parent.parent);
        // }
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
                        stmt.expression.operatorToken.kind == ts.SyntaxKind.EqualsToken &&
                        ts.isPropertyAccessExpression(stmt.expression.left)) {
                        let clsExpr = stmt.expression.left.expression;
                        let isStatic = true;
                        if (ts.isPropertyAccessExpression(clsExpr) &&
                            clsExpr.name.text == "prototype") {
                            clsExpr = clsExpr.expression;
                            isStatic = false;
                        }
                        let cls = typeChecker.getSymbolAtLocation(clsExpr);
                        if (cls && cls.valueDeclaration == node) {
                            if (node.name) {
                                if (isStatic) {
                                    members.push(ts.createProperty(
                                        undefined,
                                        [ts.createModifier(ts.SyntaxKind.StaticKeyword)],
                                        stmt.expression.left.name.text,
                                        undefined,
                                        ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                                        stmt.expression.right
                                    ));
                                    _removeStmtFromSourceFile(stmt, node.parent);
                                } else if (ts.isFunctionExpression(stmt.expression.right)) {
                                    members.push(ts.createMethod(
                                        undefined, //decorators
                                        undefined, // modifiers
                                        undefined, // asteriskToken,
                                        stmt.expression.left.name.text, //name,
                                        undefined, // questionToken,
                                        undefined, // typeParameters
                                        stmt.expression.right.parameters, // parameters
                                        undefined, // type
                                        stmt.expression.right.body, // body
                                    ));
                                    _removeStmtFromSourceFile(stmt, node.parent);
                                }
                                console.log(`${node.name.text}.${stmt.expression.left.name.text}`);
                            }
                        } else {
                            console.log(`Warning: ${stmt.expression.left.name.text}'s class not expected`);
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

    // if (classDeclaration.name && classDeclaration.name.text == "AssetTask") {
    //     debugger;
    // }

    let collectNonPropertyMembers = (classDecl: ts.ClassDeclaration) => {
        for (let member of classDecl.members) {
            if (member.name as ts.Identifier) {
                nonPropertyMembers.add((member.name as ts.Identifier).text);
            }
        }

        if (classDecl.heritageClauses) {
            for (let heri of classDecl.heritageClauses) {
                if (heri.token == ts.SyntaxKind.ExtendsKeyword) {
                    for (let type of heri.types) {
                        let baseDecl = _getValueDeclaration(type.expression, typeChecker);
                        if (baseDecl && ts.isClassDeclaration(baseDecl)) {
                            collectNonPropertyMembers(baseDecl);
                        } else {
                            // DO IT: warnning?
                        }
                    }
                }
            }
        }
    };

    collectNonPropertyMembers(classDeclaration);

    let thisMembers = new Map<string, ts.TypeNode | undefined>();
    let thisMebersDebug = new Map<string, string>();
    _forEach(classDeclaration, (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node)) {
            if (node.expression.kind == ts.SyntaxKind.ThisKeyword) {
                let type: ts.TypeNode | undefined = undefined;
                // let debugTypeName = "any";
                // if (node.parent && ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind == ts.SyntaxKind.EqualsToken) {
                //     let valNode = node.parent.right;
                //     if (ts.isNumericLiteral(valNode)) {
                //         type = ts.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
                //         debugTypeName = "number";
                //     } else if (ts.isStringLiteral(valNode)) {
                //         type = ts.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
                //         debugTypeName = "string";
                //     } else if (valNode.kind == ts.SyntaxKind.TrueKeyword ||
                //         valNode.kind == ts.SyntaxKind.FalseKeyword) {
                //         type = ts.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
                //         debugTypeName = "boolean";
                //     }
                // }
                let oldType = thisMembers.get(node.name.text);
                if (oldType) {
                    return; // DO IT
                }
                thisMembers.set(node.name.text, type);
                //thisMebersDebug.set(node.name.text, debugTypeName);
            }
        }
    });

    let properties = [];
    for (let thisMember of thisMembers) {
        if (!nonPropertyMembers.has(thisMember["0"])) {
            //console.log(`Deduce ${classDeclaration.name ? classDeclaration.name.text : "<unnamed-class>"}.${thisMember["0"]} as ${thisMebersDebug.get(thisMember["0"])}`);
            properties.push(ts.createProperty(
                undefined,
                undefined,
                thisMember["0"],
                undefined,
                thisMember["1"] ? thisMember["1"] : _createAnyTypeNode(),
                undefined
            ));
        }
    }
    _addClassMembers(properties, classDeclaration);
}

function _getValueDeclaration(node: ts.Node, typeChecker: ts.TypeChecker): ts.Declaration | undefined {
    let base = typeChecker.getSymbolAtLocation(node);
    if (base) {
        if (base.valueDeclaration) {
            return base.valueDeclaration;
        }
        let baseTypeSymbol = typeChecker.getDeclaredTypeOfSymbol(base).symbol;
        if (baseTypeSymbol) {
            return baseTypeSymbol.valueDeclaration;
        }
    }
    return undefined;
}

if (process.argv.length < 4) {
    console.log(`No input/output path specified.`);
    process.exit(-1);
}

let inputPath = process.argv[2];
let outputPath = process.argv[3];
let excludePaths = process.argv.splice(4);

main(inputPath, outputPath, ...excludePaths);