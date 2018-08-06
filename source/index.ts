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
        mkdirp(outputParentDir, (err, made) => {
            if (err) {
                console.log(`Failed to create output directory ${outputParentDir}.`);
            }
        });
        files.push(output);
        fs.copyFileSync(input, output);
    });

    let program = ts.createProgram(files, {});
    let typeChecker = program.getTypeChecker();

    let sourceFiles = program.getSourceFiles();
    for (let sourceFile of sourceFiles) {
        _forEach(sourceFile, (node: ts.Node) => {
            if (ts.isClassDeclaration(node)) {
                _injectProperties(node as ts.ClassDeclaration, typeChecker);
            }
        });
    }

    console.log(`success`);
}

function _forEach(node: ts.Node, fx: (node: ts.Node) => void) {
    fx(node);
    ts.forEachChild(node, (childNode) => {
        _forEach(childNode, fx);
    });
}

function _injectProperties(classDeclaration: ts.ClassDeclaration, typeChecker: ts.TypeChecker) {
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
        console.log(`${classDeclaration.name ? classDeclaration.name.text : "<unnamed>"} - ${ps}`);
}

main(String.raw`.\testcases\engine-3d\lib`, String.raw`.\out\engine-3d\lib`);