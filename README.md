# SPY

A tool to transform Cocos 3D project from ECMAScript to Typescript.

## Requirements

* Windows 10
* Visual Studio Code
* Node.js
* Typescript

## Usage

### Step 1

Under root directory of this reposity,
excutes the Powershell script `bootstrap.ps1`.

This script would let you select two path:

1. input path - Cocos 3D reposity's root directory.
2. output path - The generated project's root directory.

This step would copy files that
no needs to convert to Typescript format to output directory.
Some necessary files, such as `tscconfig.json` are also copied.

### Step 2

Open this reposity in Visual Studio Code,
run the task `tsc: Build` and then run the debugging.

After this step, the newly transformed Typescript files
should have been outputed to output directory.

### Step 3

Now that the transform work is finished,
switch to the output directory,
perform `npm install`. Everything should work fine.

## Implementation detail

### Transform

Main task of this tool is to convert Javascript file
to Typescript file.
These files include:

* `/index.js`

* All `*.js` under `/lib` but not under `/lib/renderer/shaders`.

* All `*.js` under `/script` except for `/script/rollup.config.js` and `/rollup-mappings.config.js`.

Each of these file will exactlly generate a corresponding
Typescript file with extension replaced `js` by `ts`.

#### Detail

The following operations are in turn performed on these Javascript files.

##### Process schemas

All expression with form

```js
x.schema = {
    /* */
}
```

where:

* `x` can be decided as a class in the context

are consider as schema declaration of Cocos 3D.

Foreach schema declaration, this tool will
remove the `get` and `set` from the object literal
and insert them into `x` as `x`'s getter or setter.
Remain content of the object literal are keeped unchangely.

##### Inject old-style class member function

All **file scope** statement with form

```js
x.y = /* */;
```

where:

* `x` can be decided as a class in same file scope;
* `y` is an identifier.

are converted:

A static public property named `y` are insert into declaration of class `x`
with inializer same as what commented.

This statement ifself are removed.

For example:

```js
class V { }
V.create = function() { return new V(); };
v.create();
```

will be transformed as:

```js
class V { static create = function() { return new V(); } }
V.create();
```

All **file scope** statement with form

```js
x.prototype.y = function(/**/) {/**/};
```

where:

* `x` can be decided as a class in same file scope;
* `y` is an identifier.

are converted:

A non-static public method named `y` are insert into declaration of class `x`.
It's arguments and body are same as what commented.

This statement ifself are removed.

For example:

```js
class V { }
V.prototype.create = function() { console.log('Hello'); };
(new V()).sayHello();
```

will be transformed as:

```js
class V { create() { console.log('Hello'); } }
(new V()).sayHello();
```

##### Inject property declarations

Foreach class declaration for class `x`,
this tool would find out
all expression with form

```js
this.m
```

where:

* `m` is an identifier

inside the class declaration.
If the `m` is not a method declarated in
class `x` or its recursive base class.

Insert a non-static public property named `m`
into declaration of class `x`.

If that expression is occurred in an
assignment expression with form

```js
this.m = v
```

where:

* `v` is a string literal or number literal or boolean literal

this tool will make the inserted property having type
`string`, `number`, `boolean` respectively.
Otherwise, let it having type `any`.

##### Assign type

Inside declaration of each variable or parameter,
this tool will mark the declaration type as `any`,
given:

* This declaration didn't specify a type

* This declaration didn't have a string literal or number literal or boolean literal initializer.

##### Context this

Foreach function expression, if a `this` keyword is
found inside this function,
insert a new parameter with name `this` and type `any`
into the front of the function's parameter list.

##### Index signature of this

All expression of the form

```js
this[/**/]
```

which occurred in method declaration of a class,

are replaced as:

```ts
(this as any)[/**/]
```

##### document and window

All expression of the form

```js
document.x
```

or

```js
window.y
```

where:

* x is one of `mozPointerLockElement`

* y is one of `XMLHttpRequest`, `ActiveXObject`, `AudioContext`, `webkitAudioContext`, `mozAudioContext`,

are replaced as:

```ts
(document as any).x
```

or

```ts
(window as any).y
```

respectively.

##### Boolean computed property name

All property assignment with form:

```js
{
    /**/
    [true]: /**/
    /**/
}
```

or

```js
{
    /**/
    [false]: /**/
    /**/
}
```

are replaced as

```ts
{
    /**/
    ["true"]: /**/
    /**/
}
```

or

```ts
{
    /**/
    ["false"]: /**/
    /**/
}
```

respectively.

##### Supply arguments

Foreach call expression,
if this tool found that
the count of arguments is less than the count of parameters needed,
the lacked arguments are supplied with `undefined`.

For example:

```js
function fx(arg1, arg2) {}
fx(0);
```

will be transformed as:

```ts
function fx(arg1, arg2) {}
fx(0, undefined);
```