import * as fs from 'fs';
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
                    console.log(`Error writing file: ${err.message}`);
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

Spy.process('testcases/vec3.js', 'out/vec3.ts');
Spy.process('testcases/complex-skinning-animation.js', 'out/complex-skinning-animation.ts');