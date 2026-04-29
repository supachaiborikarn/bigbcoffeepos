import fs from "fs";
import path from "path";
import prisma from "../prisma.js";

type Finding = {
  severity: "critical" | "high" | "medium";
  message: string;
};

const outFile = process.env.DATA_READINESS_OUT || path.resolve(process.cwd(), "production-data-readiness-report.json");

function addFinding(findings: Finding[], severity: Finding["severity"], message: string) {
  findings.push({ severity, message });
}

async function main() {
  const findings: Finding[] = [];

  const [
    activeBranches,
    activeUsers,
    admins,
    cashiers,
    activeMenu,
    coffeeMenu,
    oilMenu,
    ingredients,
    stockRows,
    reorderRows,
    recipes,
    stockControlledProducts,
    paymentMethodsSeen,
    posposSalesOnly
  ] = await Promise.all([
    prisma.branch.count({ where: { active: true } }),
    prisma.user.count({ where: { active: true } }),
    prisma.user.count({ where: { active: true, role: "admin" } }),
    prisma.user.count({ where: { active: true, role: "cashier" } }),
    prisma.menuItem.count({ where: { active: true } }),
    prisma.menuItem.count({ where: { active: true, branchType: "coffee" } }),
    prisma.menuItem.count({ where: { active: true, branchType: "oil_service" } }),
    prisma.ingredient.count(),
    prisma.ingredientStock.count(),
    prisma.ingredientStock.count({ where: { reorderLevel: { gt: 0 } } }),
    prisma.recipe.count(),
    prisma.menuItem.count({ where: { active: true, recipes: { some: {} } } }),
    prisma.order.groupBy({ by: ["paymentMethod"], _count: { _all: true } }).catch(() => []),
    prisma.order.count({ where: { items: { some: { name: "POSPOS sales-only record" } } } }).catch(() => 0)
  ]);

  if (activeBranches < 1) addFinding(findings, "critical", "No active branches are configured.");
  if (activeUsers < 1) addFinding(findings, "critical", "No active users are configured.");
  if (admins < 1) addFinding(findings, "critical", "No active admin user is configured.");
  if (cashiers < 1) addFinding(findings, "high", "No active cashier user is configured.");
  if (activeMenu < 1) addFinding(findings, "critical", "No active menu items are configured.");
  if (coffeeMenu < 1) addFinding(findings, "high", "No active coffee branch menu items are configured.");
  if (oilMenu < 1) addFinding(findings, "medium", "No active oil-service menu items are configured.");
  if (ingredients < 1) addFinding(findings, "high", "No ingredients are configured.");
  if (stockRows < 1) addFinding(findings, "high", "No branch stock rows are configured.");
  if (reorderRows < 1) addFinding(findings, "medium", "No reorder levels are configured.");
  if (recipes < 1) addFinding(findings, "critical", "No recipes are configured; checkout will not decrement stock for menu items.");
  if (activeMenu > 0 && stockControlledProducts / activeMenu < 0.5) {
    addFinding(findings, "high", `Only ${stockControlledProducts}/${activeMenu} active menu items have recipes.`);
  }

  const report = {
    checkedAt: new Date().toISOString(),
    counts: {
      activeBranches,
      activeUsers,
      admins,
      cashiers,
      activeMenu,
      coffeeMenu,
      oilMenu,
      ingredients,
      stockRows,
      reorderRows,
      recipes,
      stockControlledProducts,
      posposSalesOnly,
      paymentMethodsSeen
    },
    findings,
    dayCloseRehearsalRequired: findings.some((finding) => finding.severity === "critical" || finding.severity === "high")
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();

  if (findings.some((finding) => finding.severity === "critical")) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
