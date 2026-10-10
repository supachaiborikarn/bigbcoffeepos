// Playwright CLI run-code scenario. Uses local Vite preview :5176 and intercepted API fixtures.
async (page) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  const branches = [
    {id:1,name:'Big B Coffee วัชรเกียรติ',branchType:'coffee',active:true},
    {id:2,name:'Big B Coffee พงษ์อนันต์',branchType:'coffee',active:true},
    {id:3,name:'Big B Coffee ศุภชัย',branchType:'coffee',active:true},
    {id:4,name:'บ่อถ่ายน้ำมัน วัชรเกียรติ',branchType:'oil_service',active:true},
    {id:132,name:'บ่อถ่ายน้ำมัน พงษ์อนันต์',branchType:'oil_service',active:true}
  ];
  const items = [
    ['อเมริกาโน่','กาแฟ',65,'coffee'],['ลาเต้','กาแฟ',75,'coffee'],['มัทฉะลาเต้','ชา',85,'coffee'],['ครัวซองต์','เบเกอรี่',90,'coffee'],['คาปูชิโน่','กาแฟ',75,'coffee'],['โกโก้','เครื่องดื่ม',70,'coffee'],['น้ำมันเครื่อง 5W-30','น้ำมันเครื่อง',1250,'oil_service'],['ไส้กรองน้ำมันเครื่อง','อะไหล่',250,'oil_service'],['ค่าแรงเปลี่ยนถ่าย','บริการ',200,'oil_service'],['น้ำมันเบรก','น้ำมันเครื่อง',180,'oil_service']
  ].map(([name,category,basePrice,branchType],i)=>({id:i+1,name,category,basePrice,branchType,active:true,barcode:'TEST-'+(i+1),metadata:'{}'}));
  let user = {id:6,name:'จ๋า',role:'manager',branchId:1};
  let shift = (branchId) => ({id:branchId+500,branchId,userId:user.id,status:'OPEN',openingCash:1000,totalSales:2680,totalOrders:24,cashSales:1200,qrSales:1480,cardSales:0,openedAt:new Date().toISOString()});
  const requests=[];
  await page.unroute('**/*');
  await page.route('**/*', async route => {
    const req=route.request(); const rawUrl=req.url(); const pathname=rawUrl.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (!pathname.startsWith('/api/')) {
      if(!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(rawUrl)) return route.abort();
      return route.continue();
    }
    const body=req.postDataJSON?.() || {}, path=pathname.slice(4);
    const branchId=Number(rawUrl.match(/[?&]branchId=(\d+)/)?.[1]||req.headers()['x-branch-id']||user.branchId||1);
    const branch=branches.find(b=>b.id===branchId);
    let result={items:[]};
    if(path==='/auth/me') result={user};
    if(path==='/auth/pin') {user=body.pin==='9999'?{id:1,name:'ผู้จัดการ',role:'admin',branchId:null}:body.pin==='4444'?{id:10,name:'หมู',role:'manager',branchId:4}:body.pin==='0000'?{id:2,name:'แคชเชียร์',role:'cashier',branchId:null}:{id:6,name:'จ๋า',role:'manager',branchId:1};result={user,token:'fixture-token'};}
    if(path==='/branches') result={items:user.role==='admin'?branches:branches.filter(b=>b.id===user.branchId)};
    if(path==='/menu') result={items:items.filter(i=>i.branchType===branch?.branchType)};
    if(path==='/shifts/current') result={shift:shift(branchId)};
    if(path==='/settings/store') result={settings:{branchId,shopName:branch.name,vatMode:'NONE',vatRate:0,paymentMethods:['CASH','QR','CARD','EWALLET'],receiptFooter:'ขอบคุณที่ใช้บริการ',receiptHeader:'',addressLine:'',phone:'',taxId:'',branchLabel:''}};
    if(path==='/coupons/validate') result={coupon:{code:'QA10',type:'ORDER_FIXED',value:10}};
    if(path==='/customers') result={items:[{id:1,name:'ลูกค้าทดสอบ',phone:'0800000000',points:25}]};
    if(path==='/orders' && req.method()==='POST') {requests.push(body);result={order:{id:1001,branchId,total:body.items.reduce((s,i)=>s+(items.find(product=>product.id===i.menuItemId).basePrice+i.modifiers.reduce((sum,m)=>sum+m.price,0))*i.qty,0),createdAt:new Date().toISOString(),status:'PAID',items:[],paymentMethod:body.paymentMethod}};}
    return route.fulfill({json:result});
  });
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
  await page.goto('http://127.0.0.1:5176/login');
  await page.getByPlaceholder('● ● ● ●').fill('6666');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('heading',{name:'รับออเดอร์.'}).waitFor();
  await page.getByRole('button',{name:'เพิ่ม อเมริกาโน่',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'output/playwright/coffee-desktop.png',fullPage:true});
  const errors=[];page.on('pageerror', error=>errors.push(error.message));
  const results=[];
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  for (const width of [1440,1024,768,390,360]) {
    await page.setViewportSize({width,height:900});
    for (const appearance of ['light','dark']) {
      const current=await page.locator('.studio-app').getAttribute('data-appearance');
      if(current!==appearance)await page.getByRole('button',{name:appearance==='dark'?'ใช้โหมดมืด':'ใช้โหมดสว่าง'}).click();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      assert(!overflow,`coffee overflow ${width} ${appearance}`);
      results.push(`coffee ${width} ${appearance}`);
      if(width===390)await page.screenshot({path:`output/playwright/coffee-mobile-${appearance}.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  const cardStyle = await page.locator(".menu-card").first().evaluate(e=>({bg:getComputedStyle(e).background,surface:getComputedStyle(e).getPropertyValue("--bg-surface")}));
  assert(await page.getByRole('combobox',{name:'เลือกสาขา'}).count()===0,'single branch must not have switcher');
  await page.getByRole('button',{name:'เพิ่ม ครัวซองต์',exact:true}).click();
  assert(await page.locator('.order-list').innerText().then(x=>x.includes('ครัวซองต์')),'add cart');
  await page.getByRole('button',{name:'พักบิล',exact:true}).click();
  assert(await page.locator('.studio-held-bills>div').count()===1,'held bill');
  await page.reload();
  await page.getByRole("heading", {name:"รับออเดอร์."}).waitFor();
  await page.locator('.studio-held-bills>div>button').first().click();
  assert(await page.locator('.order-list').innerText().then(x=>x.includes('ครัวซองต์')),'restore after refresh');
  await page.getByRole('button',{name:'QR',exact:true}).click();
  await page.locator('.studio-pay-button').click();
  await page.getByPlaceholder('เลขอ้างอิงจากธนาคารหรือใบสลิป').fill('QA-REF-100');
  await page.getByRole('button',{name:'ยกเลิก',exact:true}).click();
  assert(await page.locator('.order-list').innerText().then(x=>x.includes('ครัวซองต์')),'cancel payment keeps cart');
  await page.getByRole('button',{name:'เงินสด',exact:true}).click();
  await page.locator('.studio-pay-button').click();
  await page.screenshot({path:'output/playwright/cash-payment.png',fullPage:true});
  await page.getByRole('button',{name:'฿100',exact:true}).click();
  assert(await page.locator('.cash-modal__change').innerText().then(x=>x.includes('10')),'cash change');
  await page.getByRole('button',{name:'รับเงินและพิมพ์ใบเสร็จ',exact:true}).click();
  await page.locator('.studio-sale-success').waitFor();
  assert(requests.at(-1).paymentDetails.cashReceived===100,'cash amount sent');
  assert(!requests.at(-1).paymentDetails.referenceNo,'cancelled QR reference must not reach cash');
  await page.getByRole('button',{name:'เพิ่ม ครัวซองต์',exact:true}).click();
  await page.getByRole('button',{name:'เลือกสมาชิก / สมัคร',exact:true}).click();
  await page.getByPlaceholder('ค้นหาเบอร์โทร / ชื่อลูกค้า').fill('ลูกค้า');
  await page.getByRole('button',{name:/ลูกค้าทดสอบ/}).click();
  await page.getByPlaceholder('โค้ดคูปอง').fill('QA10');
  await page.getByRole('button',{name:'ใช้คูปอง',exact:true}).click();
  await page.getByRole('button',{name:'ลบคูปอง',exact:true}).waitFor();
  await page.getByRole('button',{name:'พักบิล',exact:true}).click();
  assert(await page.getByRole('button',{name:'ลบสมาชิก',exact:true}).count()===0,'held member must leave new bill');
  assert(await page.getByRole('button',{name:'ลบคูปอง',exact:true}).count()===0,'held coupon must leave new bill');
  await page.reload();
  await page.locator('.studio-held-bills>div>button').first().click();
  assert(await page.getByRole('button',{name:'ลบสมาชิก',exact:true}).count()===1,'restore member');
  assert(await page.getByRole('button',{name:'ลบคูปอง',exact:true}).count()===1,'restore coupon');
  await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
  await page.getByPlaceholder('● ● ● ●').fill('4444');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('heading',{name:'สินค้าและบริการ.'}).waitFor();
  await page.getByRole('button',{name:'เพิ่ม น้ำมันเครื่อง 5W-30',exact:true}).waitFor();
  assert(await page.locator('.menu-card').count()===4,'oil catalog only');
  assert(await page.getByRole('link',{name:'คิวเครื่องดื่ม'}).count()===0,'hide coffee queue');
  await page.getByLabel('รายละเอียดรถ / งานบริการ').fill('กข 1234 · 85000 กม. · เปลี่ยนน้ำมันเครื่อง');
  await page.getByRole('button',{name:'เพิ่ม น้ำมันเครื่อง 5W-30',exact:true}).click();
  for (const width of [1440,1024,768,390,360]) {
    await page.setViewportSize({width,height:900});
    for (const appearance of ['light','dark']) {
      const current=await page.locator('.studio-app').getAttribute('data-appearance');
      if(current!==appearance)await page.getByRole('button',{name:appearance==='dark'?'ใช้โหมดมืด':'ใช้โหมดสว่าง'}).click();
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),`oil overflow ${width} ${appearance}`);
      results.push(`oil ${width} ${appearance}`);
      if([1440,390].includes(width))await page.screenshot({path:`output/playwright/oil-${width}-${appearance}.png`,animations:'disabled'});
    }
  }
  await page.locator('.pos-cart-fab').click();
  assert(await page.locator('.order-list').innerText().then(x=>x.includes('น้ำมันเครื่อง')),'mobile cart');
  await page.getByRole('button',{name:'บัตร',exact:true}).click();
  await page.locator('.studio-pay-button').click();
  await page.getByPlaceholder('เลขอ้างอิงจากธนาคารหรือใบสลิป').fill('CARD-TEST-1');
  await page.getByRole('button',{name:'ยืนยันและบันทึก',exact:true}).click();
  await page.locator('.studio-sale-success').waitFor();
  assert(requests.at(-1).paymentDetails.referenceNo==='CARD-TEST-1','save reference');
  assert(requests.at(-1).items[0].note.includes('กข 1234'),'save vehicle note');
  assert(requests.at(-1).branchId===4,'save oil branch');
  await page.getByRole('button',{name:'เปิดเมนู',exact:true}).click();
  await page.locator('.sidebar--mobile-open').waitFor();
  await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
  await page.getByPlaceholder('● ● ● ●').fill('9999');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('button',{name:/Big B Coffee วัชรเกียรติ/}).click();
  await page.getByRole('heading',{name:'รับออเดอร์.'}).waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'เพิ่ม ครัวซองต์',exact:true}).click();
  await page.getByRole('combobox',{name:'เลือกสาขา'}).selectOption('132');
  await page.getByRole('heading',{name:'สินค้าและบริการ.'}).waitFor();
  assert(await page.locator('.order-list').innerText().then(x=>!x.includes('ครัวซองต์')),'no coffee cart in new branch');
  await page.getByRole('button',{name:'เพิ่ม ค่าแรงเปลี่ยนถ่าย',exact:true}).click();
  await page.getByLabel('รายละเอียดรถ / งานบริการ').fill('ทดสอบสาขาใหม่');
  await page.getByRole('combobox',{name:'เลือกสาขา'}).selectOption('1');
  await page.getByRole('heading',{name:'รับออเดอร์.'}).waitFor();
  assert(await page.locator('.order-list').innerText().then(x=>x.includes('ครัวซองต์')&&!x.includes('ค่าแรง')),'restore coffee cart after switch');
  await page.getByRole('combobox',{name:'เลือกสาขา'}).selectOption('132');
  await page.getByRole('heading',{name:'สินค้าและบริการ.'}).waitFor();
  assert(await page.getByLabel('รายละเอียดรถ / งานบริการ').inputValue()==='ทดสอบสาขาใหม่','restore branch vehicle note');
  assert(await page.locator('.order-list').innerText().then(x=>x.includes('ค่าแรง')),'restore oil cart after switch');
  await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
  await page.getByPlaceholder('● ● ● ●').fill('0000');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('heading',{name:'บัญชียังไม่มีสาขาที่เปิดใช้งาน'}).waitFor();
  return {results,errors,payments:requests.map(r=>({branchId:r.branchId,method:r.paymentMethod,reference:r.paymentDetails.referenceNo,note:r.items[0].note})),unassignedDenied:true};
}
