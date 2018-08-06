import * as fs from 'fs';
import * as path from 'path';
import mkdirp from 'mkdirp';
import * as ts from 'typescript';

class Spy {
    static process(inputPath: string, outputPath: string) {
        fs.readFile(inputPath, (err: NodeJS.ErrnoException, data: Buffer) => {
            if (err) {
                console.log(`Error reading file: ${err.message}`);
            }
            fs.writeFile(
                outputPath,
                new SourceConverter(data.toString()).print(),
                (err: NodeJS.ErrnoException) => {
                    if (err) {
                        console.log(`Error writing file: ${err.message}`);
                    }
                });
        });
    }
}

class SourceConverter {
    private _sourceFile: ts.SourceFile;

    private _forEach(node: ts.Node, fx: (node: ts.Node) => void) {
        fx(node);
        ts.forEachChild(node, (childNode) => {
            this._forEach(childNode, fx);
        });
    }

    constructor(content: string) {
        this._sourceFile = ts.createSourceFile("", content, ts.ScriptTarget.Latest);

        this._forEach(this._sourceFile, (node: ts.Node) => {
            if (ts.isClassDeclaration(node)) {
                this._injectProperties(node as ts.ClassDeclaration);
            }
        });
    }

    print() {
        const printer = ts.createPrinter({
            newLine: ts.NewLineKind.LineFeed
        });
        return printer.printFile(this._sourceFile);
    }

    _injectProperties(classDeclaration: ts.ClassDeclaration) {
        let nonPropertyMembers = new Set<string>();
        for (let member of classDeclaration.members) {
            if (member.name as ts.Identifier) {
                nonPropertyMembers.add((member.name as ts.Identifier).text);
            }
        }

        let thisMembers = new Set<string>();
        this._forEach(classDeclaration, (node: ts.Node) => {
            if (ts.isPropertyAccessExpression(node)) {
                if (node.expression.kind == ts.SyntaxKind.ThisKeyword) {
                    thisMembers.add(node.name.text);
                }
            }
        });

        let properties = [];
        for (let thisMember of thisMembers) {
            if (!nonPropertyMembers.has(thisMember)) {
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
    }
}

function main(inputDir: string, outputDir: string) {
    let rootDir = inputDir;

    let forEachFile = (dir: string, fx: (file: string) => void) => {
        fs.readdir(dir, (err, files) => {
            if (err) {
                return;
            }
            for (let file of files) {
                file = path.resolve(dir, file);
                fs.stat(file, (err, stat) => {
                    if (stat && stat.isDirectory()) {
                        forEachFile(file, fx);
                    }
                    else if (file.endsWith(".js")) {
                        fx(path.relative(rootDir, file));
                    }
                });
            }
        });
    };

    forEachFile(inputDir, (file) => {
        let input = path.resolve(inputDir, file);
        let output = path.resolve(outputDir, file);
        output = output.replace(".js", ".ts");
        let outputParentDir = path.dirname(output);
        mkdirp(outputParentDir, (err, made) => {
            if (err) {
                console.log(`Failed to create output directory ${outputParentDir}.`);
            }
        });
        Spy.process(input, output);
    });
}

main(String.raw`E:\Repos\Cocos\engine-3d\lib`, String.raw`D:\out`);