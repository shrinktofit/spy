import * as esprima from 'esprima';
import * as fs from 'fs';
import * as estree from 'estree';
import * as ts from 'typescript';

fs.readFile('testcases/complex-skinning-animation.js', (err: NodeJS.ErrnoException, data: Buffer) => {
    if (err) {
        console.log(`Error loading file: ${err.message}`);
    }
    let filestr = data.toString();
    new Spy(filestr).print('out/complex-skinning-animation.ts');
});

class Spy {
    private _tsStatements: ts.NodeArray<ts.Statement>;
    private _thisMembers: Set<string> = new Set<string>();
    private _nonPropertyMembers: Set<string> = new Set<string>();
    private _program: estree.Program;

    constructor(content: string) {
        this._program = esprima.parseModule(content, {
            loc: true,
            range: true,
            //attachComment: true
        });

        this._tsStatements = this._processProgram(this._program);
    }

    print(outPath: string) {
        const resultFile = ts.createSourceFile(
            outPath,
            "",
            ts.ScriptTarget.Latest);
        resultFile.statements = this._tsStatements;

        const printer = ts.createPrinter({
            newLine: ts.NewLineKind.LineFeed
        });

        const result = printer.printFile(resultFile);
        fs.writeFile(outPath, result, (err: NodeJS.ErrnoException) => { });
    }

    _processProgram(program: esprima.Program): ts.NodeArray<ts.Statement> {
        let tsBody: ts.Statement[] = [];
        for (let item of program.body) {
            if (item as estree.Statement) {
                tsBody.push(this._processStatement(item as estree.Statement));
            } else if (item as estree.ModuleDeclaration) {

            }
        }
        return ts.createNodeArray(tsBody);
    }

    _processClassDeclaration(classDeclaration: estree.ClassDeclaration): ts.ClassDeclaration {

        this._thisMembers.clear();
        this._nonPropertyMembers.clear();

        let tsClassName: ts.Identifier | undefined = undefined;
        if (classDeclaration.id != null) {
            tsClassName = this._processIdentifier(classDeclaration.id);
        }

        let tsHeritageClauseArray: ts.HeritageClause[] = [];
        if (classDeclaration.superClass) {
            let tsSuperExpr = ts.createExpressionWithTypeArguments(
                [],
                this._processExpression(classDeclaration.superClass));
            let tsHeritageClause = ts.createHeritageClause(
                ts.SyntaxKind.ExtendsKeyword,
                [tsSuperExpr]
            );
            tsHeritageClauseArray.push(tsHeritageClause);
        }

        let tsClassElements: ts.ClassElement[] = [];
        for (let methodDefinition of classDeclaration.body.body) {
            tsClassElements.push(this._processMethodDefinition(methodDefinition));
        }

        for (let name of this._thisMembers) {
            if (this._nonPropertyMembers.has(name)) {
                continue;
            }
            let property = ts.createProperty(
                undefined,
                undefined,
                name,
                undefined,
                ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                undefined
            );
            tsClassElements.push(property);
        }

        return ts.createClassDeclaration(
            undefined,
            undefined,
            tsClassName,
            undefined,
            tsHeritageClauseArray,
            tsClassElements
        );
    }

    _processMethodDefinition(methodDefinition: estree.MethodDefinition): ts.ClassElement {
        let tsModifiers: ts.Modifier[] = [];
        if (methodDefinition.static) {
            tsModifiers.push(ts.createModifier(ts.SyntaxKind.StaticKeyword));
        }

        let paramsBody = this._parseParamsBodyFromFunctionExpression(methodDefinition.value);

        if (methodDefinition.kind == "constructor") {
            return ts.createConstructor(
                undefined, // decorators
                tsModifiers, // modifiers,
                paramsBody.parameters, // parameters
                paramsBody.body // body
            );
        }

        let tsName = this._processPropertyName(methodDefinition.key, methodDefinition.computed);
        if (tsName as ts.Identifier) {
            this._nonPropertyMembers.add((tsName as ts.Identifier).text);
        }

        if (methodDefinition.kind == "method") {
            return ts.createMethod(
                undefined, // decorators
                tsModifiers, // modifiers,
                undefined, // asteriskToken
                tsName, // name
                undefined, // questionToken
                undefined, // typeParameters
                paramsBody.parameters, // parameters
                undefined,
                paramsBody.body // body
            );
        } else if (methodDefinition.kind == "get") {
            return ts.createGetAccessor(
                undefined, // decorators
                tsModifiers, // modifiers
                tsName, // name
                paramsBody.parameters, // parameters,
                undefined, // type
                paramsBody.body// body
            );
        } else { // if (methodDefinition.kind == "set")
            return ts.createSetAccessor(
                undefined, // decorators
                tsModifiers, // modifiers
                tsName, // name
                paramsBody.parameters, // parameters,
                paramsBody.body// body
            );
        }
    }

    _processBlockStatement(blockStatement: estree.BlockStatement): ts.Block {
        const stmts: ts.Statement[] = [];

        for (let statement of blockStatement.body) {
            stmts.push(this._processStatement(statement));
        }

        return ts.createBlock(stmts, true);
    }

    _processStatement(statement: estree.Statement): ts.Statement {
        let result = (() => {
            switch (statement.type) {
                case "BlockStatement":
                    return this._processBlockStatement(statement);
                case "ExpressionStatement":
                    return this._processExpressionStatement(
                        statement as estree.ExpressionStatement);
                case "VariableDeclaration":
                    return this._processVariableDeclaration(statement);
                case "ReturnStatement":
                    return this._processReturnStatement(statement);
                case "IfStatement":
                    return this._processIfStatement(statement);
                case "WhileStatement":
                    return this._processWhileStatement(statement);
                case "DoWhileStatement":
                    return this._processDoWhileStatement(statement);
                case "BreakStatement":
                    return this._processBreakStatement(statement);
                case "ContinueStatement":
                    return this._processContinueStatement(statement);
                case "ThrowStatement":
                    return this._processThrowStatement(statement);
                case "EmptyStatement":
                    return ts.createEmptyStatement();
                case "WithStatement":
                    return this._processWithStatement(statement);
                case "ClassDeclaration":
                    return this._processClassDeclaration(statement);
                case "FunctionDeclaration":
                    return this._processFunctionDeclaration(statement);
            }
            return ts.createEmptyStatement();
        })();
        this._processComments(statement, result);
        return result;
    }

    _processExpressionStatement(expressionStatement: estree.ExpressionStatement) {
        let tsExpression = this._processExpression(expressionStatement.expression);
        return ts.createStatement(tsExpression);
    }

    _processReturnStatement(returnStatement: estree.ReturnStatement): ts.Statement {
        let tsReturnExpr = undefined;
        if (returnStatement.argument) {
            tsReturnExpr = this._processExpression(returnStatement.argument);
        }
        return ts.createReturn(tsReturnExpr);
    }

    _processIfStatement(ifStatement: estree.IfStatement): ts.Statement {

        let tsCond = this._processExpression(ifStatement.test);

        let tsThen = this._processStatement(ifStatement.consequent);

        let tsElse: ts.Statement | undefined = undefined;
        if (ifStatement.alternate) {
            tsElse = this._processStatement(ifStatement.alternate);
        }

        return ts.createIf(
            tsCond,
            tsThen,
            tsElse
        );
    }

    _processWhileStatement(whileStatement: estree.WhileStatement): ts.Statement {

        let tsCond = this._processExpression(whileStatement.test);

        let tsThen = this._processStatement(whileStatement.body);

        return ts.createWhile(
            tsCond,
            tsThen
        );
    }

    _processDoWhileStatement(doWhileStatement: estree.DoWhileStatement): ts.Statement {

        let tsCond = this._processExpression(doWhileStatement.test);

        let tsThen = this._processStatement(doWhileStatement.body);

        return ts.createWhile(
            tsCond,
            tsThen
        );
    }

    _processWithStatement(withStatement: estree.WithStatement): ts.Statement {

        let tsObject = this._processExpression(withStatement.object);

        let tsBody = this._processStatement(withStatement.body);

        return ts.createWith(tsObject, tsBody);
    }

    _processThrowStatement(throwStatement: estree.ThrowStatement): ts.Statement {
        let tsExpr = this._processExpression(throwStatement.argument);

        return ts.createThrow(tsExpr);
    }

    _processBreakStatement(breakStatement: estree.BreakStatement): ts.Statement {
        let tsLabel: ts.Identifier | undefined = undefined;
        if (breakStatement.label) {
            tsLabel = this._processIdentifier(breakStatement.label);
        }

        return ts.createBreak(tsLabel);
    }

    _processContinueStatement(continueStatement: estree.ContinueStatement): ts.Statement {
        let tsLabel: ts.Identifier | undefined = undefined;
        if (continueStatement.label) {
            tsLabel = this._processIdentifier(continueStatement.label);
        }

        return ts.createContinue(tsLabel);
    }

    _processVariableDeclaration(variableDeclaration: estree.VariableDeclaration): ts.Statement {
        let tsDecls: ts.VariableDeclaration[] = [];
        for (let varDecl of variableDeclaration.declarations) {
            let tsName: ts.BindingName | undefined = undefined;
            if (varDecl.id.type == "Identifier") {
                tsName = this._processIdentifier(varDecl.id);
            }

            let tsInitor: ts.Expression | undefined = undefined;
            if (varDecl.init) {
                tsInitor = this._processExpression(varDecl.init);
            }

            if (!tsName) {
                // error
                continue;
            }

            let tsVarDecl = ts.createVariableDeclaration(
                tsName,
                ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                tsInitor
            );
            tsDecls.push(tsVarDecl);
        }

        let tsNodeFlags: ts.NodeFlags | undefined = undefined;
        switch (variableDeclaration.kind) {
            case "let":
                tsNodeFlags = ts.NodeFlags.Let;
                break;
            case "const":
                tsNodeFlags = ts.NodeFlags.Const;
                break;
        }

        let tsVarDeclList = ts.createVariableDeclarationList(
            tsDecls,
            tsNodeFlags
        );

        return ts.createVariableStatement(
            undefined,
            tsVarDeclList
        );
    }

    _processFunctionDeclaration(functionDeclaration: estree.FunctionDeclaration): ts.FunctionDeclaration {
        let paramsBody = this._parseParamsBodyFromFunctionExpression(functionDeclaration);

        let tsName: ts.Identifier | undefined = undefined;
        if (functionDeclaration.id) {
            tsName = this._processIdentifier(functionDeclaration.id);
        }

        return ts.createFunctionDeclaration(
            undefined, // decorators
            undefined, // modifiers,
            undefined, // asteriskToken
            tsName, // name
            undefined, // typeParameters
            paramsBody.parameters, // parameters
            undefined,
            paramsBody.body // body
        );
    }

    _processExpression(expression: estree.Expression): ts.Expression {
        let result = (() => {
            switch (expression.type) {
                case "ThisExpression":
                    return this._processThisExpression(expression as estree.ThisExpression);
                case "Identifier":
                    return this._processIdentifier(expression);
                case "Literal":
                    return this._processLiteralExpression(expression);
                case "NewExpression":
                    return this._processNewExpression(expression);
                case "CallExpression":
                    return this._processCallExpression(expression);
                case "AssignmentExpression":
                    return this._processAssignmentExpression(expression as estree.AssignmentExpression);
                case "BinaryExpression":
                    return this._processBinaryExpression(expression);
                case "MemberExpression":
                    return this._processMemberExpression(expression as estree.MemberExpression);
                case "ArrayExpression":
                    return this._processArrayExpression(expression);
                case "UnaryExpression":
                    return this._processUnaryExpression(expression);
                case "UpdateExpression":
                    return this._processUpdateExpression(expression);
                case "LogicalExpression":
                    return this._processLogicalExpression(expression);
                case "ArrowFunctionExpression":
                    return this._processArrowFunctionExpression(expression);
                case "FunctionExpression":
                    return this._processFunctionExpression(expression);
                case "ObjectExpression":
                    return this._processObjectExpression(expression);
                default:
                    // error
                    return ts.createThis();
            }
        })();
        this._processComments(expression, result);
        return result;
    }

    _processAssignmentExpression(assignmentExpression: estree.AssignmentExpression): ts.Expression {

        let tsLeftExpr: ts.Expression | undefined = undefined;
        if (assignmentExpression.left.type == "MemberExpression") {
            tsLeftExpr = this._processMemberExpression(assignmentExpression.left);
        } else if (assignmentExpression.left.type == "Identifier") {
            tsLeftExpr = this._processIdentifier(assignmentExpression.left);
        }

        let tsRightExpr = this._processExpression(assignmentExpression.right);

        if (tsLeftExpr)
            return ts.createAssignment(tsLeftExpr, tsRightExpr);
        return ts.createThis();
    }

    _processCallExpression(callExpresion: estree.CallExpression): ts.Expression {
        let tsExpr = callExpresion.callee.type == "Super" ?
            ts.createSuper() :
            this._processExpression(callExpresion.callee);

        let tsArgs: ts.Expression[] = [];
        for (let arg of callExpresion.arguments) {
            if (arg.type != "SpreadElement") {
                tsArgs.push(this._processExpression(arg));
            }
        }

        return ts.createCall(
            tsExpr,
            undefined,
            tsArgs
        );
    }

    _processBinaryExpression(binarayExpression: estree.BinaryExpression) {
        let tsLeftExpr = this._processExpression(binarayExpression.left);

        let tsRightExpr = this._processExpression(binarayExpression.right);

        let tsOperator: ts.BinaryOperator | undefined = undefined;
        switch (binarayExpression.operator) {
            case "+":
                tsOperator = ts.SyntaxKind.PlusToken;
                break;
            case "-":
                tsOperator = ts.SyntaxKind.MinusToken;
                break;
            case "*":
                tsOperator = ts.SyntaxKind.AsteriskToken;
                break;
            case "/":
                tsOperator = ts.SyntaxKind.SlashToken;
                break;
            case "%":
                tsOperator = ts.SyntaxKind.PercentToken;
                break;
            case "!=":
                tsOperator = ts.SyntaxKind.ExclamationEqualsToken;
                break;
            case "!==":
                tsOperator = ts.SyntaxKind.ExclamationEqualsEqualsToken;
                break;
            case "==":
                tsOperator = ts.SyntaxKind.EqualsEqualsToken;
                break;
            case "===":
                tsOperator = ts.SyntaxKind.EqualsEqualsEqualsToken;
                break;
            case "&":
                tsOperator = ts.SyntaxKind.AmpersandToken;
                break;
            case "**":
                tsOperator = ts.SyntaxKind.AmpersandAmpersandToken;
                break;
            case "<":
                tsOperator = ts.SyntaxKind.LessThanToken;
                break;
            case "<<":
                tsOperator = ts.SyntaxKind.LessThanLessThanToken;
                break;
            case "<=":
                tsOperator = ts.SyntaxKind.LessThanEqualsToken;
                break;
            case ">":
                tsOperator = ts.SyntaxKind.GreaterThanToken;
                break;
            case ">>":
                tsOperator = ts.SyntaxKind.GreaterThanGreaterThanToken;
                break;
            case ">>>":
                tsOperator = ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken;
                break;
            case ">=":
                tsOperator = ts.SyntaxKind.GreaterThanEqualsToken;
                break;
            case "^":
                tsOperator = ts.SyntaxKind.CaretToken;
                break;
            case "in":
                tsOperator = ts.SyntaxKind.InKeyword;
                break;
            case "instanceof":
                tsOperator = ts.SyntaxKind.InstanceOfKeyword;
                break;
            case "|":
                tsOperator = ts.SyntaxKind.BarToken;
                break;

        }

        if (tsOperator)
            return ts.createBinary(tsLeftExpr, tsOperator, tsRightExpr);

        // error
        return ts.createThis();
    }

    _processLogicalExpression(logicalExpression: estree.LogicalExpression) {
        let tsLeftExpr = this._processExpression(logicalExpression.left);

        let tsRightExpr = this._processExpression(logicalExpression.right);

        let tsOperator: ts.BinaryOperator | undefined = undefined;
        switch (logicalExpression.operator) {
            case "&&":
                tsOperator = ts.SyntaxKind.AmpersandAmpersandToken;
                break;
            case "||":
                tsOperator = ts.SyntaxKind.BarBarToken;
                break;

        }

        if (tsOperator)
            return ts.createBinary(tsLeftExpr, tsOperator, tsRightExpr);

        // error
        return ts.createThis();
    }

    _processUnaryExpression(unaryExpression: estree.UnaryExpression) {
        let tsOperand = this._processExpression(unaryExpression.argument);

        let tsOperator: ts.PrefixUnaryOperator | undefined = undefined;
        switch (unaryExpression.operator) {
            case "+":
                tsOperator = ts.SyntaxKind.PlusToken;
                break;
            case "-":
                tsOperator = ts.SyntaxKind.MinusToken;
                break;
            case "!":
                tsOperator = ts.SyntaxKind.ExclamationToken;
                break;
            case "~":
                tsOperator = ts.SyntaxKind.TildeToken;
                break;
            case "typeof":
                return ts.createTypeOf(tsOperand);
            case "delete":
                return ts.createDelete(tsOperand);
            case "void":
                return ts.createVoid(tsOperand);
        }

        if (tsOperator)
            return ts.createPrefix(tsOperator, tsOperand);

        // error
        return ts.createThis();
    }

    _processUpdateExpression(updateExpression: estree.UpdateExpression) {
        let tsOperand = this._processExpression(updateExpression.argument);

        if (updateExpression.prefix) {
            switch (updateExpression.operator) {
                case "++":
                    return ts.createPrefix(ts.SyntaxKind.PlusPlusToken, tsOperand);
                case "--":
                    return ts.createPrefix(ts.SyntaxKind.MinusMinusToken, tsOperand);
            }
        } else {
            switch (updateExpression.operator) {
                case "++":
                    return ts.createPostfix(tsOperand, ts.SyntaxKind.PlusPlusToken);
                case "--":
                    return ts.createPostfix(tsOperand, ts.SyntaxKind.MinusMinusToken);
            }
        }

        // error
        return ts.createThis();
    }

    _processArrayExpression(arrayExpression: estree.ArrayExpression) {
        const tsElems: ts.Expression[] = [];
        for (let elem of arrayExpression.elements) {
            if (elem.type != "SpreadElement") {
                tsElems.push(this._processExpression(elem));
            }
        }
        return ts.createArrayLiteral(tsElems);
    }

    _processThisExpression(thisExpression: estree.ThisExpression) {
        return ts.createThis();
    }

    _processMemberExpression(memberExpression: estree.MemberExpression) {
        if (memberExpression.object.type == "ThisExpression") {
            if (memberExpression.property.type == "Identifier") {
                this._thisMembers.add(memberExpression.property.name);
            }
        }

        let tsObject: ts.Expression | null = null;
        if (memberExpression.object.type == "Super") {
            tsObject = ts.createSuper();
        } else {
            tsObject = this._processExpression(memberExpression.object);
        }

        let property = memberExpression.property;
        if (!memberExpression.computed) {
            if (property.type == "Identifier") {
                let tsPropertyName = this._processIdentifier(property);
                return ts.createPropertyAccess(
                    tsObject,
                    this._processIdentifier(property));
            } else {
                console.log(`Syntax error.`);
                // fallthrough
            }
        }

        return ts.createElementAccess(
            tsObject,
            this._processExpression(property));
    }

    _processObjectExpression(objectExpression: estree.ObjectExpression) {
        // type ObjectLiteralElementLike = PropertyAssignment | ShorthandPropertyAssignment | SpreadAssignment | MethodDeclaration | AccessorDeclaration
        let tsProperties: ts.ObjectLiteralElementLike[] = [];
        for (let property of objectExpression.properties) {
            let tsName = this._processPropertyName(property.key, property.computed);

            let tsProperty: ts.ObjectLiteralElementLike | undefined = undefined;
            if (property.kind == "get" || property.kind == "set" ||
                (property.kind == "init" && property.method)) {
                let value: estree.FunctionExpression = (property.value as estree.Expression) as estree.FunctionExpression;
                let paramsBody = this._parseParamsBodyFromFunctionExpression(value);
                if (property.kind == "get") {
                    tsProperty = ts.createGetAccessor(
                        undefined, // decorators
                        undefined, // modifiers
                        tsName, // name
                        paramsBody.parameters, // parameters,
                        undefined, // type
                        paramsBody.body// body
                    );
                } else if (property.kind == "set") {
                    tsProperty = ts.createSetAccessor(
                        undefined, // decorators
                        undefined, // modifiers
                        tsName, // name
                        paramsBody.parameters, // parameters,
                        paramsBody.body// body
                    );
                } else {
                    tsProperty = ts.createMethod(
                        undefined, // decorators
                        undefined, // modifiers,
                        undefined, // asteriskToken
                        tsName, // name
                        undefined, // questionToken
                        undefined, // typeParameters
                        paramsBody.parameters, // parameters
                        undefined,
                        paramsBody.body // body
                    );
                }
            } else if (property.shorthand) {
                tsProperty = ts.createShorthandPropertyAssignment(
                    tsName as ts.Identifier
                );
            } else {
                tsProperty = ts.createPropertyAssignment(
                    tsName,
                    this._processExpression(property.value as estree.Expression),
                );
            }

            tsProperties.push(tsProperty);
        }

        return ts.createObjectLiteral(
            tsProperties,
            tsProperties.length != 0 ? true : false
        );
    }

    _processIdentifier(identifier: estree.Identifier): ts.Identifier {
        return ts.createIdentifier(identifier.name);
    }

    _processLiteralExpression(literal: estree.Literal): ts.LiteralExpression {
        let value = literal.value;
        switch (typeof (value)) {
            case "number":
                return ts.createNumericLiteral(literal.raw as string);
            case "boolean":
                return ts.createNumericLiteral(literal.raw as string);
            case "string":
                return ts.createStringLiteral(value as string);
        }

        // error
        return ts.createLiteral("");
    }

    _processNewExpression(newExpression: estree.NewExpression) {
        let tsCallee: ts.Expression | undefined = undefined;

        if (newExpression.callee.type == "Super") {

        }
        else {
            tsCallee = this._processExpression(newExpression.callee);
        }

        let tsArgs: ts.Expression[] = [];
        for (let arg of newExpression.arguments) {
            if (arg.type != "SpreadElement") {
                tsArgs.push(this._processExpression(arg));
            }
        }

        if (tsCallee) {
            return ts.createNew(
                tsCallee,
                undefined,
                tsArgs);
        }
        return ts.createThis();
    }

    _processArrowFunctionExpression(arrowFunctionExpression: estree.ArrowFunctionExpression): ts.Expression {

        let tsParameterDeclaration: ts.ParameterDeclaration[] = [];
        for (const param of arrowFunctionExpression.params) {
            if (param.type == "Identifier") {
                let tsParamName = this._processIdentifier(param);
                let tsParam = ts.createParameter(
                    undefined,
                    undefined,
                    undefined,
                    tsParamName,
                    undefined,
                    ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    undefined
                );
                tsParameterDeclaration.push(tsParam);
            }
        }

        let tsBody: ts.ConciseBody = arrowFunctionExpression.expression ?
            this._processExpression(arrowFunctionExpression.body as estree.Expression) :
            this._processBlockStatement(arrowFunctionExpression.body as estree.BlockStatement);

        let tsResult = ts.createArrowFunction(
            undefined,
            undefined,
            tsParameterDeclaration,
            undefined,
            undefined,
            tsBody
        );

        return tsResult;
    }

    _processFunctionExpression(functionExpression: estree.FunctionExpression): ts.Expression {

        let tsFuncName: ts.Identifier | undefined = undefined;
        if (functionExpression.id) {
            tsFuncName = this._processIdentifier(functionExpression.id);
        }

        let paramsBody = this._parseParamsBodyFromFunctionExpression(functionExpression);

        return ts.createFunctionExpression(
            undefined, // modifiers
            undefined, // asteriskToken,
            tsFuncName, // name
            undefined, // typeParameters
            paramsBody.parameters, // parameters
            undefined, // type
            paramsBody.body
        );
    }

    _processPropertyName(name: estree.Expression, computed: boolean): ts.PropertyName {
        let tsName: ts.PropertyName | undefined = undefined;
        if (computed) {
            tsName = ts.createComputedPropertyName(this._processExpression(name));
        } else if (name.type == "Identifier") {
            tsName = this._processIdentifier(name);
        } else if (name.type == "Literal") {
            if (typeof (name.value) == "number" && name.raw) {
                tsName = ts.createNumericLiteral(name.raw);
            } else if (typeof (name.value) == "string") {
                tsName == ts.createStringLiteral(name.value);
            }
        }

        if (!tsName) {
            // error
            return ts.createIdentifier("__SPY_ERROR_PROPERTY_NAME__");
        }
        return tsName;
    }

    _parseParamsBodyFromFunctionExpression(functionExpression: estree.FunctionExpression | estree.FunctionDeclaration) {
        let tsParameterDeclaration: ts.ParameterDeclaration[] = [];
        for (const param of functionExpression.params) {
            if (param.type == "Identifier") {
                let tsParamName = this._processIdentifier(param);
                let tsParam = ts.createParameter(
                    undefined,
                    undefined,
                    undefined,
                    tsParamName,
                    undefined,
                    ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    undefined
                );
                tsParameterDeclaration.push(tsParam);
            }
        }

        let tsBody: ts.ConciseBody = this._processBlockStatement(functionExpression.body);
        return { parameters: tsParameterDeclaration, body: tsBody };
    }

    _processComments(node: estree.Node, tsNode: ts.Node) {
        if (node.leadingComments) {
            for (let comment of node.leadingComments) {
                ts.addSyntheticLeadingComment(
                    tsNode,
                    comment.type == "Line" ? ts.SyntaxKind.SingleLineCommentTrivia : ts.SyntaxKind.MultiLineCommentTrivia,
                    comment.value,
                    true);
            }
        }
        // else if (node.trailingComments) {
        //     for (let comment of node.trailingComments) {
        //         ts.addSyntheticTrailingComment(
        //             tsNode,
        //             comment.type == "Line" ? ts.SyntaxKind.SingleLineCommentTrivia : ts.SyntaxKind.MultiLineCommentTrivia,
        //             comment.value,
        //             true);
        //     }
        // }
    }
}