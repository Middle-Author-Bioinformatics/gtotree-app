import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('account return locations cannot redirect off site; result code survives login',async()=>{
  const directory=await mkdtemp(fileURLToPath(new URL('./.auth-',import.meta.url)));
  try{await build({entryPoints:[fileURLToPath(new URL('../src/lib/account-config.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:directory+'/config.mjs',define:{'import.meta.env':'{}'},logLevel:'silent'});
    const {safeReturnTo,validApiBase}=await import(pathToFileURL(directory+'/config.mjs'));
    assert.equal(safeReturnTo('/?result=Example123','https://tree.example'),'/?result=Example123');
    for(const bad of ['https://evil.test/','//evil.test/','javascript:alert(1)'])assert.equal(safeReturnTo(bad,'https://tree.example'),'/');
    assert.equal(safeReturnTo('/?code=secret&state=secret&result=Example123','https://tree.example'),'/?result=Example123');
    assert.equal(validApiBase('https://user:secret@api.example'),false);assert.equal(validApiBase('http://api.example'),false);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('sandbox report has private theme storage and remains functional without application storage',async()=>{
  const directory=await mkdtemp(fileURLToPath(new URL('./.auth-',import.meta.url)));
  try{await build({entryPoints:[fileURLToPath(new URL('../src/lib/report-sandbox.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',outfile:directory+'/report.mjs',logLevel:'silent'});
    const {sandboxedReport}=await import(pathToFileURL(directory+'/report.mjs'));
    const dom=new JSDOM(sandboxedReport('<html><head></head><body><script>document.body.textContent=localStorage.getItem("gt-report-theme")</script></body></html>','dark'),{runScripts:'dangerously'});
    assert.equal(dom.window.document.body.textContent,'dark');assert.equal(dom.window.localStorage.getItem('tokens'),null);dom.window.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('admin CSV values cannot become spreadsheet formulas',async()=>{
  const directory=await mkdtemp(fileURLToPath(new URL('./.auth-',import.meta.url)));
  try{await build({entryPoints:[fileURLToPath(new URL('../src/lib/account-api.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',outfile:directory+'/csv.mjs',define:{'import.meta.env':'{}'},logLevel:'silent'});
    const {csvCell}=await import(pathToFileURL(directory+'/csv.mjs'));
    for(const value of ['=HYPERLINK("evil")','+cmd','-cmd','@SUM(1)','  =1','\t=1'])assert(csvCell(value).startsWith('"\''));
    assert.equal(csvCell('Lab "A"'),'"Lab ""A"""');
  }finally{await rm(directory,{recursive:true,force:true});}
});
