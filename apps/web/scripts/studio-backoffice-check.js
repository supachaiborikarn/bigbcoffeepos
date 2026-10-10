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
  const requests=[], stockUpdates=[], assigned=[];
  let stock=[{ingredientId:10,name:'เมล็ดกาแฟ',unit:'กรัม',stockQty:1250,reorderLevel:500},{ingredientId:11,name:'นมสด',unit:'กล่อง',stockQty:2,reorderLevel:5}];
  let members=[{id:1,name:'ลูกค้าทดสอบ',phone:'0800000000',points:25,createdAt:'2026-01-01'}];
  let pending=[{id:20,name:'สมาชิกเดิม',phone:'0811111111',points:12,createdAt:'2026-01-01',historicalBranchIds:[1,2]}];
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
    if(path==='/customers') result={items:members};
    if(path==='/customers/insights') result={insights:{summary:{totalCustomers:members.length,inactiveDays:60,inactiveCustomers:0,recentSpendTotal:1250,averageSpendPerCustomer:1250},highValueCustomers:[],inactiveCustomers:[]}};
    if(path==='/customers/unassigned') result={items:pending};
    if(path==='/customers/20/branch'&&req.method()==='PUT'){assigned.push(body);members.push(pending[0]);pending=[];result={customer:members.at(-1)};}
    if(path==='/inventory') result={items:stock};
    if(path==='/inventory/10'&&req.method()==='PUT'){stockUpdates.push(body);stock=stock.map(item=>item.ingredientId===10?{...item,...body}:item);result={item:stock[0]};}
    if(path==='/orders' && req.method()==='POST') {requests.push(body);result={order:{id:1001,branchId,total:body.items.reduce((s,i)=>s+(items.find(product=>product.id===i.menuItemId).basePrice+i.modifiers.reduce((sum,m)=>sum+m.price,0))*i.qty,0),createdAt:new Date().toISOString(),status:'PAID',items:[],paymentMethod:body.paymentMethod}};}
    return route.fulfill({json:result});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const assert=(ok,message)=>{if(!ok)throw new Error(message);};
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
  await page.goto('http://127.0.0.1:5176/login');
  for(const width of [1440,768,390,360]) {
    await page.setViewportSize({width,height:900});
    assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),`login overflow ${width}`);
    if(width===1440||width===390)await page.screenshot({path:`output/playwright/login-${width}.png`,fullPage:true});
  }
  await page.getByPlaceholder('● ● ● ●').fill('6666');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('heading',{name:'รับออเดอร์.'}).waitFor();
  await page.getByRole('button',{name:'เพิ่ม ลาเต้',exact:true}).click();
  await page.getByRole('button',{name:'หวานน้อย (50%)',exact:true}).click();
  await page.getByRole('button',{name:/เพิ่มช็อตกาแฟ/}).click();
  await page.getByRole('button',{name:/เพิ่มลงตะกร้า/}).click();
  await page.locator('.pos-cart-fab').click();
  assert((await page.locator('.order-list').innerText()).includes('50%'),'sweetness in bill');
  assert((await page.locator('.order-list').innerText()).includes('เพิ่มช็อตกาแฟ'),'add on in bill');
  await page.goto('http://127.0.0.1:5176/inventory');
  await page.getByRole('button',{name:'ปรับสต็อก เมล็ดกาแฟ'}).waitFor();
  await page.getByRole('button',{name:/ถึงจุดสั่งซื้อ/}).click();
  assert(await page.getByRole('button',{name:'ปรับสต็อก เมล็ดกาแฟ'}).count()===0,'low stock filter');
  await page.getByRole('button',{name:/ถึงจุดสั่งซื้อ/}).click();
  await page.getByLabel('ค้นหาในสต็อก').fill('เมล็ด');
  assert(await page.getByRole('button',{name:'ปรับสต็อก นมสด'}).count()===0,'stock search');
  await page.getByRole('button',{name:'ปรับสต็อก เมล็ดกาแฟ'}).click();
  await page.getByLabel('ยอดคงเหลือจริง (กรัม)').fill('1500');
  await page.getByLabel('แจ้งเตือนเมื่อเหลือ').fill('600');
  await page.getByRole('button',{name:'บันทึกสต็อก',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert(stockUpdates.length===1&&stockUpdates[0].branchId===1&&stockUpdates[0].stockQty===1500,'save own stock');
  assert(Object.keys(stockUpdates[0]).sort().join()===['branchId','reorderLevel','stockQty'].join(),'only branch stock values submitted');
  await page.getByLabel('ค้นหาในสต็อก').fill('');
  for(const width of [1440,768,390,360]) {
    await page.setViewportSize({width,height:900});
    for(const appearance of ['light','dark']) {
      if(await page.locator('.studio-app').getAttribute('data-appearance')!==appearance)await page.getByRole('button',{name:appearance==='dark'?'ใช้โหมดมืด':'ใช้โหมดสว่าง'}).click();
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),`stock overflow ${width} ${appearance}`);
      if(width===1440||width===390)await page.screenshot({path:`output/playwright/stock-${width}-${appearance}.png`,fullPage:true});
    }
  }
  await page.getByRole('button',{name:'รายการขาย',exact:true}).click();
  assert((await page.locator('.studio-stock-table').innerText()).includes('ลาเต้'),'business catalog visible');
  assert(!(await page.locator('.studio-stock-table').innerText()).includes('น้ำมันเครื่อง'),'business catalog filtered');
  await page.goto('http://127.0.0.1:5176/customers');
  await page.getByRole('heading',{name:'สมาชิกของร้าน'}).waitFor();
  assert(await page.getByRole('button',{name:/รอจัดสาขา/}).count()===0,'manager has no global customer assignment');
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
  await page.getByPlaceholder('● ● ● ●').fill('9999');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('button',{name:/Big B Coffee วัชรเกียรติ/}).click();
  await page.goto('http://127.0.0.1:5176/customers');
  await page.getByRole('button',{name:'รอจัดสาขา (1)',exact:true}).click();
  for(const width of [1440,768,390,360]) {
    await page.setViewportSize({width,height:900});
    for(const appearance of ['light','dark']) {
      if(await page.locator('.studio-app').getAttribute('data-appearance')!==appearance)await page.getByRole('button',{name:appearance==='dark'?'ใช้โหมดมืด':'ใช้โหมดสว่าง'}).click();
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),`members overflow ${width} ${appearance}`);
      if(width===1440||width===390)await page.screenshot({path:`output/playwright/members-${width}-${appearance}.png`,fullPage:true});
    }
  }
  await page.getByLabel('สาขาประจำ สมาชิกเดิม').selectOption('1');
  await page.getByRole('button',{name:'ผูกสาขา',exact:true}).click();
  await page.getByText('ไม่มีสมาชิกรอจัดสาขา',{exact:true}).waitFor();
  assert(assigned.length===1&&assigned[0].branchId===1,'explicit member assignment');
  await page.getByRole('button',{name:'สมาชิกสาขานี้',exact:true}).click();
  await page.getByLabel('ค้นหาสมาชิก').fill('0811111111');
  assert((await page.locator('.studio-member-list').innerText()).includes('สมาชิกเดิม'),'assigned contact appears in correct branch');
  assert(errors.length===0,`page errors: ${errors.join(', ')}`);
  return {loginWidths:4,stockViewports:8,customerViewports:8,stockUpdates,assigned,modifierVerified:true,errors};
}
