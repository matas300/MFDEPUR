-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addressId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "paymentIntentId" TEXT,
    "paymentReference" TEXT,
    "subtotal" DECIMAL NOT NULL,
    "taxRate" DECIMAL NOT NULL DEFAULT 0.22,
    "taxAmount" DECIMAL NOT NULL,
    "shippingCost" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL,
    "notes" TEXT,
    "adminNotes" TEXT,
    "trackingNumber" TEXT,
    "trackingCarrier" TEXT,
    "trackingUrl" TEXT,
    "paidAt" DATETIME,
    "shippedAt" DATETIME,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("addressId", "adminNotes", "companyId", "createdAt", "deliveredAt", "id", "notes", "orderNumber", "paidAt", "paymentIntentId", "paymentMethod", "shippedAt", "shippingCost", "status", "subtotal", "taxAmount", "taxRate", "total", "trackingCarrier", "trackingNumber", "trackingUrl", "updatedAt", "userId") SELECT "addressId", "adminNotes", "companyId", "createdAt", "deliveredAt", "id", "notes", "orderNumber", "paidAt", "paymentIntentId", "paymentMethod", "shippedAt", "shippingCost", "status", "subtotal", "taxAmount", "taxRate", "total", "trackingCarrier", "trackingNumber", "trackingUrl", "updatedAt", "userId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
