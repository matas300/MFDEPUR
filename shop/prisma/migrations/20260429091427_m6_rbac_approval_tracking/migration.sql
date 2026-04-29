-- AlterTable
ALTER TABLE "Order" ADD COLUMN "trackingCarrier" TEXT;
ALTER TABLE "Order" ADD COLUMN "trackingUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "companyRole" TEXT DEFAULT 'BUYER';

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT NOT NULL,
    "fiscalCode" TEXT,
    "sdiCode" TEXT,
    "pec" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "requiresOrderApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("createdAt", "fiscalCode", "id", "name", "notes", "pec", "phone", "sdiCode", "status", "updatedAt", "vatNumber", "website") SELECT "createdAt", "fiscalCode", "id", "name", "notes", "pec", "phone", "sdiCode", "status", "updatedAt", "vatNumber", "website" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_vatNumber_key" ON "Company"("vatNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Bootstrap: utente più vecchio per company esistente diventa COMPANY_ADMIN
UPDATE "User" SET "companyRole" = 'COMPANY_ADMIN'
WHERE "id" IN (
  SELECT u1."id" FROM "User" u1
  WHERE u1."companyId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "User" u2
      WHERE u2."companyId" = u1."companyId"
        AND (u2."createdAt" < u1."createdAt"
             OR (u2."createdAt" = u1."createdAt" AND u2."id" < u1."id"))
    )
);
