import * as esprima from 'esprima';

let program = esprima.parseScript('console.log(hello);');
console.log(program);