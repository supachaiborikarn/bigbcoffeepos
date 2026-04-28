import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting customer data cleanup...");

  const customers = await prisma.customer.findMany();
  let updatedCount = 0;

  for (const customer of customers) {
    const originalName = customer.name;
    
    // Regular expression to match:
    // 1. One or more spaces
    // 2. Exactly 4 digits
    // 3. Optional whitespace followed by anything in parentheses
    // 4. Optional trailing whitespace at the end of the string
    const cleanName = originalName.replace(/\s+\d{4}\s*(?:\([^)]*\))?\s*$/, "").trim();

    if (cleanName !== originalName) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { name: cleanName },
      });
      console.log(`Cleaned: '${originalName}' -> '${cleanName}'`);
      updatedCount++;
    }
  }

  console.log(`\nCleanup complete! Updated ${updatedCount} out of ${customers.length} customers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
