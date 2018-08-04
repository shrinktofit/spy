import * as esprima from 'esprima';
import * as fs from 'fs';
import * as estree from 'estree';
import * as ts from 'typescript';

fs.readFile('testcases/vec3.js', (err: NodeJS.ErrnoException, data: Buffer) => {
    if (err) {
        console.log(`Error loading file: ${err.message}`);
    }
    let filestr = data.toString();
    new Spy(filestr).print('out/vec3.ts');
});

class Spy {
    private _tsStatements: ts.NodeArray<ts.Statement>;
    private _thisMembers: string[] = [];
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
        for (let bodyItem of program.body) {
            switch (bodyItem.type) {
                case "ClassDeclaration":
                    tsBody.push(this._processClassDeclaration(bodyItem));
                    break;
            }
        }
        return ts.createNodeArray(tsBody);
    }

    _processClassDeclaration(classDeclaration: estree.ClassDeclaration): ts.ClassDeclaration {

        this._thisMembers = [];

        let tsClassElements: ts.ClassElement[] = [];
        for (let methodDefinition of classDeclaration.body.body) {
            tsClassElements.push(this._processMethodDefinition(methodDefinition));
        }

        for (let name of this._thisMembers) {
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

        let tsClassName: ts.Identifier | undefined = undefined;
        if (classDeclaration.id != null) {
            tsClassName = this._processIdentifier(classDeclaration.id);
        }

        let tsClassDecl = ts.createClassDeclaration(
            undefined,
            undefined,
            tsClassName,
            undefined,
            undefined,
            tsClassElements
        );
        this._processComments(classDeclaration, tsClassDecl);

        return tsClassDecl;
    }

    _processMethodDefinition(methodDefinition: estree.MethodDefinition): ts.ClassElement {
        let tsModifiers: ts.Modifier[] = [];
        if (methodDefinition.static) {
            tsModifiers.push(ts.createModifier(ts.SyntaxKind.StaticKeyword));
        }

        let tsParametersDeclaration: ts.ParameterDeclaration[] = [];
        for (const param of methodDefinition.value.params) {
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
                tsParametersDeclaration.push(tsParam);
            }
        }

        const tsBody = this._processBlockStatement(methodDefinition.value.body);

        let tsMethod = ts.createMethod(
            undefined,
            tsModifiers,
            undefined,
            (methodDefinition.key as estree.Identifier).name,
            undefined,
            undefined,
            tsParametersDeclaration,
            undefined,
            tsBody
        );
        this._processComments(methodDefinition, tsMethod);

        return tsMethod;
    }

    _processBlockStatement(blockStatement: estree.BlockStatement): ts.Block {
        const stmts: ts.Statement[] = [];

        for (let statement of blockStatement.body) {
            stmts.push(this._processStatement(statement));
        }

        return ts.createBlock(stmts, true);
    }

    _processStatement(statement: estree.Statement): ts.Statement {
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
                return this._processComments(statement, ts.createEmptyStatement()) as ts.Statement;
            case "WithStatement":
                return this._processWithStatement(statement);
        }
        return ts.createEmptyStatement();
    }

    _processExpressionStatement(expressionStatement: estree.ExpressionStatement) {
        let tsExpression = this._processExpression(expressionStatement.expression);
        return ts.createExpressionStatement(tsExpression);;
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

        let tsIfStmt = ts.createIf(
            tsCond,
            tsThen,
            tsElse
        );
        this._processComments(ifStatement, tsIfStmt);

        return tsIfStmt;
    }

    _processWhileStatement(whileStatement: estree.WhileStatement): ts.Statement {

        let tsCond = this._processExpression(whileStatement.test);

        let tsThen = this._processStatement(whileStatement.body);

        let tsWhileStmt = ts.createWhile(
            tsCond,
            tsThen
        );
        this._processComments(whileStatement, tsWhileStmt);

        return tsWhileStmt;
    }

    _processDoWhileStatement(doWhileStatement: estree.DoWhileStatement): ts.Statement {

        let tsCond = this._processExpression(doWhileStatement.test);

        let tsThen = this._processStatement(doWhileStatement.body);

        let tsDoWhileStmt = ts.createWhile(
            tsCond,
            tsThen
        );
        this._processComments(doWhileStatement, tsDoWhileStmt);

        return tsDoWhileStmt;
    }

    _processWithStatement(withStatement: estree.WithStatement): ts.Statement {

        let tsObject = this._processExpression(withStatement.object);

        let tsBody = this._processStatement(withStatement.body);

        let tsWithStmt = ts.createWith(tsObject, tsBody);
        this._processComments(withStatement, tsWithStmt);

        return tsWithStmt;
    }

    _processThrowStatement(throwStatement: estree.ThrowStatement): ts.Statement {
        let tsExpr = this._processExpression(throwStatement.argument);

        let tsThrow = ts.createThrow(tsExpr);
        this._processComments(throwStatement, tsThrow);

        return tsThrow;
    }

    _processBreakStatement(breakStatement: estree.BreakStatement): ts.Statement {
        let tsLabel: ts.Identifier | undefined = undefined;
        if (breakStatement.label) {
            tsLabel = this._processIdentifier(breakStatement.label);
        }

        let tsBreak = ts.createBreak(tsLabel);
        this._processComments(breakStatement, tsBreak);

        return tsBreak;
    }

    _processContinueStatement(continueStatement: estree.ContinueStatement): ts.Statement {
        let tsLabel: ts.Identifier | undefined = undefined;
        if (continueStatement.label) {
            tsLabel = this._processIdentifier(continueStatement.label);
        }

        let tsContinue = ts.createContinue(tsLabel);
        this._processComments(continueStatement, tsContinue);

        return tsContinue;
    }

    _processVariableDeclaration(variableDeclaration: estree.VariableDeclaration): ts.Statement {
        let tsDecls: ts.VariableDeclaration[] = [];
        for (let varDecl of variableDeclaration.declarations) {
            let tsName: string | ts.Identifier | undefined = undefined;
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

    _processExpression(expression: estree.Expression): ts.Expression {
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
        }

        // error
        return ts.createThis();
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
                this._thisMembers.push(memberExpression.property.name);
            }
        }

        let tsObject: ts.Expression | null = null;
        if (memberExpression.object.type == "Super") {
            tsObject = ts.createSuper();
        } else {
            tsObject = this._processExpression(memberExpression.object);
        }

        let property = memberExpression.property;
        let tsPropertyName: string | ts.Identifier | undefined = undefined;
        if (property.type == "Identifier") {
            tsPropertyName = this._processIdentifier(property);
        } else {
            console.log(`Don't know how to convert.`);
        }

        return ts.createPropertyAccess(tsObject, tsPropertyName);
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

    _processComments(node: estree.Node, tsNode: ts.Node) {
        if (node.leadingComments) {
            for (let comment of node.leadingComments) {
                ts.addSyntheticLeadingComment(
                    tsNode,
                    comment.type == "Line" ? ts.SyntaxKind.SingleLineCommentTrivia : ts.SyntaxKind.MultiLineCommentTrivia,
                    comment.value,
                    true);
            }
        } else if (node.trailingComments) {
            for (let comment of node.trailingComments) {
                ts.addSyntheticTrailingComment(
                    tsNode,
                    comment.type == "Line" ? ts.SyntaxKind.SingleLineCommentTrivia : ts.SyntaxKind.MultiLineCommentTrivia,
                    comment.value,
                    true);
            }
        }
        return tsNode;
    }
}