import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/never_connect";
const { default: prisma } = await import("../prisma.js");
const { default: express } = await import("express");
const { generateToken, requireAuth, requireBranchAccess, requireRole } = await import("../middleware/auth.js");
const { resolveBranchScope, requireRecordBranch, protectSharedConfiguration } = await import("../middleware/branchScope.js");
const { customerHomeBranch } = await import("../store/customerScope.js");
const { getCustomers } = await import("../store/customers.js");
let record = { id: 6, name: "fixture", role: "manager", branchId: 1 as number | null, active: true, branch: { active: true } };
(prisma.user as any).findUnique = async () => record;
(prisma.branch as any).findFirst = async ({ where }: any) => [1, 2, 3, 4, 132].includes(where.id) ? { id: where.id, branchType: where.id >= 4 ? "oil_service" : "coffee" } : null;
(prisma.ingredientStock as any).findFirst = async ({ where }: any) => where.branchId === 1 && where.ingredientId === 10 ? { id: 1 } : null;
const customers = [
  { id:1,metadata:'{"workspaceBranchId":1}',orders:[] },
  { id:2,metadata:'{}',orders:[{branchId:1}] },
  { id:3,metadata:'{}',orders:[{branchId:2}] },
  { id:4,metadata:'{}',orders:[{branchId:1},{branchId:2}] },
  { id:5,metadata:'{}',orders:[] }
];
(prisma.customer as any).findMany = async () => customers;
const app = express();
app.use(express.json(), requireAuth, resolveBranchScope, protectSharedConfiguration);
app.get('/branches', (_req,res) => res.json({ reached:true }));
app.get('/auth/me', (req:any,res) => res.json({ user:req.user }));
app.get('/customers/unassigned', requireRole('admin'), (_req,res) => res.json({ reached:true }));
app.post('/customers/:id/branch', requireRole('admin'), (_req,res) => res.json({ reached:true }));
app.get('/orders', requireBranchAccess((req) => Number(req.query.branchId)||null), (_req,res) => res.json({ reached:true }));
app.get('/compare', requireBranchAccess((req) => Number(req.query.branchIdA)||null), (_req,res) => res.json({ reached:true }));
app.post('/orders/:id', requireRecordBranch(async(req) => ({ branchId:Number(req.params.id) })), (_req,res) => res.json({ reached:true }));
app.all('*', (_req,res) => res.json({ reached:true }));
const server = app.listen(0,'127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address=server.address() as {port:number};
const token=generateToken({id:6,name:'fixture',role:'admin',branchId:null});
let count=0;
async function check(path:string, expected:number, body?:Record<string,unknown>, extra?:Record<string,string>) {
  const response=await fetch(`http://127.0.0.1:${address.port}${path}`, {method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...extra},body:body?JSON.stringify(body):undefined});
  assert.equal(response.status,expected,`${path} -> ${await response.text()}`);count++;
}
try {
  await check('/orders?branchId=1',200);
  await check('/customers/unassigned',403);
  await check('/customers/1/branch',403,{branchId:1});
  await check('/orders?branchId=2',403); // same business, different branch
  await check('/orders?branchId=4',403); // different business, same location
  await check('/orders',400); // no accidental all-branch query
  await check('/orders?branchId=1',403,undefined,{'X-Branch-Id':'2'});
  await check('/orders/2',403,{});
  await check('/orders/1',200,{});
  await check('/compare?branchIdA=1&branchIdB=2',403);
  await check('/stock-transfers',403,{fromBranchId:1,toBranchId:2});
  await check('/menu',403,{name:'shared edit'});
  await check('/recipes/10',403,{items:[]});
  await check('/coupons/validate',200,{code:'fixture'});
  await check('/migration/sync/latest',403);
  await check('/inventory/10',403,{branchId:1,name:'shared edit'});
  await check('/inventory/20',403,{branchId:1,stockQty:5});
  await check('/inventory/10',200,{branchId:1,stockQty:5});
  record={...record,branchId:2}; // assignment changes while token still says admin
  await check('/orders?branchId=1',403);
  await check('/orders?branchId=2',200);
  record={...record,active:false};await check('/orders?branchId=2',401);
  record={...record,active:true,branchId:null,role:'cashier'};
  await check('/branches',200);await check('/orders?branchId=1',403);
  record={...record,role:'admin'};
  await check('/customers/unassigned',200);
  await check('/customers/1/branch',200,{branchId:132});
  await check('/orders?branchId=1',200);await check('/orders?branchId=132',200);await check('/orders',200);
  assert.equal(customerHomeBranch(customers[1]),1);
  assert.equal(customerHomeBranch(customers[3]),null);
  assert.deepEqual((await getCustomers(undefined,1)).map((c)=>c.id),[1,2]);
  assert.deepEqual((await getCustomers(undefined,2)).map((c)=>c.id),[3]);
  assert.equal((await getCustomers()).length,5);
  console.log(`PASS ${count} HTTP permission scenarios + 5 customer isolation checks; no database connection`);
} finally { server.close();await prisma.$disconnect(); }
