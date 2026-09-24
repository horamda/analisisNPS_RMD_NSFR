import {chromium,expect} from '@playwright/test';
import fs from 'node:fs/promises';

const url=process.env.UI_TEST_URL||'http://127.0.0.1:5175';
const output='test-results/dashboard';
await fs.mkdir(output,{recursive:true});
const auth=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.ADMIN_USERNAME||'admin',password:process.env.ADMIN_PASSWORD||'admin1234'})});
if(!auth.ok)throw new Error('No se pudo autenticar la prueba local');
const session=await auth.json();
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>{localStorage.setItem('claims_session',JSON.stringify(s));localStorage.setItem('theme','light');},session);
 // Keep visual checks independent from the external Sheets network.
 await page.route('https://docs.google.com/**',route=>route.fulfill({status:503,body:''}));
 await page.goto(url);
 await expect(page.locator('.overview-stat strong').first()).not.toHaveText('...',{timeout:20000});
 await expect(page.locator('.overview-error')).toHaveCount(0);
 async function check(name){
   const size=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));
   if(size.page>size.viewport+1)throw Error(`${name}: horizontal overflow ${JSON.stringify(size)}`);
   await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 }
 async function navigate(name){
   if(page.viewportSize().width<=760)await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
   await page.getByRole('navigation',{name:'Modulos'}).getByRole('button',{name,exact:true}).click();
   await expect(page.locator('.page-heading h1')).toHaveText(name);
   if(page.viewportSize().width<=760)await expect(page.locator('.app-sidebar')).toHaveCSS('visibility','hidden');
   if(name==='Inicio')await expect(page.locator('.overview-stat strong').first()).not.toHaveText('...',{timeout:20000});
   if(name==='Reclamos')await expect(page.getByText(/\d+ resultados/)).toBeVisible({timeout:20000});
   if(name==='Importaciones')await expect(page.getByRole('button',{name:/filas$/}).first()).toBeVisible({timeout:20000});
   if(['RMD','NPS','NS FR'].includes(name))await expect(page.locator('.recharts-line-curve').first()).toBeVisible();
 }
 await check('desktop-home-light');
 await page.getByRole('button',{name:'Activar modo oscuro',exact:true}).click();
 await check('desktop-home-dark');
 await page.getByRole('button',{name:'Activar modo claro',exact:true}).click();
 for(const module of ['RMD','NPS','NS FR','Reclamos','Importaciones','Analisis IA','Informe ejecutivo']){
   await navigate(module);
   await expect(page.locator('.loading-module')).toHaveCount(0);
   const expected=['RMD','NPS','NS FR'].includes(module)?1:0;
   await expect(page.locator('.module-metrics')).toHaveCount(expected);
   await check('desktop-'+module.replaceAll(' ','-'));
 }
 await page.getByRole('button',{name:'Activar modo oscuro',exact:true}).click();
 for(const module of ['RMD','Reclamos','Informe ejecutivo']){await navigate(module);await check('dark-'+module);}
 await page.getByRole('button',{name:'Activar modo claro',exact:true}).click();
 for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   for(const module of ['Inicio','Reclamos','RMD','NPS','NS FR','Importaciones','Informe ejecutivo']){
     await navigate(module);await check(`mobile-${width}-${module.replaceAll(' ','-')}`);
   }
   await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
   await page.screenshot({path:`${output}/mobile-${width}-menu.png`});
   await page.keyboard.press('Escape');
   await expect(page.getByRole('button',{name:'Abrir menu',exact:true})).toBeFocused();
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS: navegacion, temas, indicadores por modulo y ancho responsive 1440/390/320. Capturas: '+output);
}finally{await browser.close();}
