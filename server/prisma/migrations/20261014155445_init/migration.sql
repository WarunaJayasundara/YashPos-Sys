-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `maxDiscountPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(60) NOT NULL,
    `description` VARCHAR(200) NOT NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `fullName` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `roleId` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(64) NOT NULL,
    `userId` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sessions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `categories_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brands` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `brands_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `contactPerson` VARCHAR(120) NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(120) NULL,
    `address` VARCHAR(255) NULL,
    `businessRegNo` VARCHAR(60) NULL,
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sku` VARCHAR(40) NOT NULL,
    `barcode` VARCHAR(40) NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `categoryId` INTEGER NOT NULL,
    `brandId` INTEGER NULL,
    `supplierId` INTEGER NULL,
    `variantGroup` VARCHAR(60) NULL,
    `compatibility` VARCHAR(255) NULL,
    `color` VARCHAR(40) NULL,
    `size` VARCHAR(40) NULL,
    `connectorType` VARCHAR(40) NULL,
    `purchasePrice` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `avgCost` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `sellingPrice` DECIMAL(12, 2) NOT NULL,
    `minSellingPrice` DECIMAL(12, 2) NOT NULL,
    `qtyOnHand` INTEGER NOT NULL DEFAULT 0,
    `qtyReserved` INTEGER NOT NULL DEFAULT 0,
    `reorderLevel` INTEGER NOT NULL DEFAULT 5,
    `maxStockLevel` INTEGER NULL,
    `warrantyMonths` INTEGER NOT NULL DEFAULT 0,
    `imageUrl` VARCHAR(255) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_sku_key`(`sku`),
    UNIQUE INDEX `products_barcode_key`(`barcode`),
    INDEX `products_name_idx`(`name`),
    INDEX `products_variantGroup_idx`(`variantGroup`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `price_history` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `field` VARCHAR(30) NOT NULL,
    `oldValue` DECIMAL(12, 2) NOT NULL,
    `newValue` DECIMAL(12, 2) NOT NULL,
    `changedById` INTEGER NULL,
    `reason` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `price_history_productId_createdAt_idx`(`productId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poNumber` VARCHAR(30) NOT NULL,
    `supplierId` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'ORDERED',
    `supplierInvoiceNo` VARCHAR(60) NULL,
    `purchaseDate` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `invoiceTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amountPaid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_orders_poNumber_key`(`poNumber`),
    INDEX `purchase_orders_supplierId_idx`(`supplierId`),
    INDEX `purchase_orders_purchaseDate_idx`(`purchaseDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseOrderId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `qtyOrdered` INTEGER NOT NULL,
    `qtyReceived` INTEGER NOT NULL DEFAULT 0,
    `qtyDamaged` INTEGER NOT NULL DEFAULT 0,
    `qtyMissing` INTEGER NOT NULL DEFAULT 0,
    `unitCost` DECIMAL(12, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptNumber` VARCHAR(30) NOT NULL,
    `purchaseOrderId` INTEGER NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `additionalCost` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `receivedById` INTEGER NOT NULL,

    UNIQUE INDEX `goods_receipts_receiptNumber_key`(`receiptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goods_receipt_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `goodsReceiptId` INTEGER NOT NULL,
    `purchaseItemId` INTEGER NOT NULL,
    `qtyReceived` INTEGER NOT NULL,
    `qtyDamaged` INTEGER NOT NULL DEFAULT 0,
    `qtyMissing` INTEGER NOT NULL DEFAULT 0,
    `qtyAccepted` INTEGER NOT NULL,
    `landedUnitCost` DECIMAL(12, 4) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supplier_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `supplierId` INTEGER NOT NULL,
    `purchaseOrderId` INTEGER NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT') NOT NULL,
    `reference` VARCHAR(80) NULL,
    `paidAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recordedById` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(120) NULL,
    `notes` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceNumber` VARCHAR(30) NOT NULL,
    `clientRequestId` VARCHAR(64) NOT NULL,
    `status` ENUM('COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED') NOT NULL DEFAULT 'COMPLETED',
    `customerId` INTEGER NULL,
    `customerName` VARCHAR(120) NULL,
    `customerPhone` VARCHAR(30) NULL,
    `cashierId` INTEGER NOT NULL,
    `cashierName` VARCHAR(120) NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `lineDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `billDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(12, 2) NOT NULL,
    `totalCost` DECIMAL(12, 2) NOT NULL,
    `amountPaid` DECIMAL(12, 2) NOT NULL,
    `amountTendered` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `changeDue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `balanceDue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `discountApprovedById` INTEGER NULL,
    `notes` VARCHAR(255) NULL,
    `offlineCreatedAt` DATETIME(3) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` INTEGER NULL,
    `voidReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_invoiceNumber_key`(`invoiceNumber`),
    UNIQUE INDEX `sales_clientRequestId_key`(`clientRequestId`),
    INDEX `sales_createdAt_idx`(`createdAt`),
    INDEX `sales_cashierId_createdAt_idx`(`cashierId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `productName` VARCHAR(160) NOT NULL,
    `sku` VARCHAR(40) NOT NULL,
    `qty` INTEGER NOT NULL,
    `qtyReturned` INTEGER NOT NULL DEFAULT 0,
    `listPrice` DECIMAL(12, 2) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `lineDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `lineTotal` DECIMAL(12, 2) NOT NULL,
    `allocatedBillDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `unitCost` DECIMAL(12, 4) NOT NULL,
    `serialNumber` VARCHAR(80) NULL,
    `warrantyMonths` INTEGER NOT NULL DEFAULT 0,

    INDEX `sale_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `method` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reference` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_method_createdAt_idx`(`method`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `saleId` INTEGER NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT') NOT NULL,
    `reference` VARCHAR(80) NULL,
    `recordedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `returns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `returnNumber` VARCHAR(30) NOT NULL,
    `saleId` INTEGER NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'REFUND',
    `refundTotal` DECIMAL(12, 2) NOT NULL,
    `costReversed` DECIMAL(12, 2) NOT NULL,
    `processedById` INTEGER NOT NULL,
    `approvedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `returns_returnNumber_key`(`returnNumber`),
    INDEX `returns_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `return_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `returnId` INTEGER NOT NULL,
    `saleItemId` INTEGER NOT NULL,
    `qty` INTEGER NOT NULL,
    `restock` BOOLEAN NOT NULL,
    `refundAmount` DECIMAL(12, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `returnId` INTEGER NOT NULL,
    `method` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `refunds_method_createdAt_idx`(`method`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `type` ENUM('OPENING', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'DAMAGED', 'LOST', 'ADJUSTMENT') NOT NULL,
    `qtyChange` INTEGER NOT NULL,
    `qtyAfter` INTEGER NOT NULL,
    `unitCost` DECIMAL(12, 4) NOT NULL,
    `refType` VARCHAR(30) NULL,
    `refId` INTEGER NULL,
    `reason` VARCHAR(255) NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movements_productId_createdAt_idx`(`productId`, `createdAt`),
    INDEX `stock_movements_type_createdAt_idx`(`type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `type` ENUM('OPENING', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID', 'CUSTOMER_RETURN', 'SUPPLIER_RETURN', 'DAMAGED', 'LOST', 'ADJUSTMENT') NOT NULL,
    `qtyChange` INTEGER NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
    `requestedById` INTEGER NOT NULL,
    `approvedById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(60) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `expenseDate` DATETIME(3) NOT NULL,
    `method` ENUM('CASH', 'CARD', 'BANK_TRANSFER', 'QR', 'CREDIT') NOT NULL,
    `reference` VARCHAR(80) NULL,
    `attachmentUrl` VARCHAR(255) NULL,
    `paidFromDrawer` BOOLEAN NOT NULL DEFAULT false,
    `recordedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expenses_expenseDate_idx`(`expenseDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_closings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessDate` DATE NOT NULL,
    `openingFloat` DECIMAL(12, 2) NOT NULL,
    `cashSales` DECIMAL(12, 2) NOT NULL,
    `cashCollections` DECIMAL(12, 2) NOT NULL,
    `cashRefunds` DECIMAL(12, 2) NOT NULL,
    `cashExpenses` DECIMAL(12, 2) NOT NULL,
    `expectedCash` DECIMAL(12, 2) NOT NULL,
    `countedCash` DECIMAL(12, 2) NOT NULL,
    `difference` DECIMAL(12, 2) NOT NULL,
    `nonCashTotals` JSON NOT NULL,
    `notes` VARCHAR(255) NULL,
    `closedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cash_closings_businessDate_key`(`businessDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `warranties` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `saleItemId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `serialNumber` VARCHAR(80) NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `claimStatus` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `claimNotes` TEXT NULL,
    `resolution` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `warranties_saleItemId_key`(`saleItemId`),
    INDEX `warranties_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `username` VARCHAR(50) NULL,
    `action` VARCHAR(60) NOT NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entityId` VARCHAR(40) NULL,
    `details` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `shopName` VARCHAR(120) NOT NULL DEFAULT 'YASH MOBILE',
    `address` VARCHAR(255) NOT NULL DEFAULT '',
    `phone` VARCHAR(60) NOT NULL DEFAULT '',
    `email` VARCHAR(120) NOT NULL DEFAULT '',
    `logoUrl` VARCHAR(255) NULL,
    `receiptWidth` INTEGER NOT NULL DEFAULT 80,
    `defaultPrintFormat` VARCHAR(10) NOT NULL DEFAULT '80',
    `receiptFooter` VARCHAR(255) NOT NULL DEFAULT 'Thank you for shopping with us!',
    `warrantyPolicy` TEXT NOT NULL DEFAULT '',
    `taxLabel` VARCHAR(20) NOT NULL DEFAULT 'VAT',
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `taxRegNo` VARCHAR(60) NOT NULL DEFAULT '',
    `invoicePrefix` VARCHAR(10) NOT NULL DEFAULT 'YM',
    `currency` VARCHAR(10) NOT NULL DEFAULT 'Rs.',
    `language` VARCHAR(5) NOT NULL DEFAULT 'en',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_sequences` (
    `key` VARCHAR(30) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `brands`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_history` ADD CONSTRAINT `price_history_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_items` ADD CONSTRAINT `goods_receipt_items_goodsReceiptId_fkey` FOREIGN KEY (`goodsReceiptId`) REFERENCES `goods_receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goods_receipt_items` ADD CONSTRAINT `goods_receipt_items_purchaseItemId_fkey` FOREIGN KEY (`purchaseItemId`) REFERENCES `purchase_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_payments` ADD CONSTRAINT `customer_payments_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `returns` ADD CONSTRAINT `returns_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_items` ADD CONSTRAINT `return_items_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `returns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `return_items` ADD CONSTRAINT `return_items_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `returns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `warranties` ADD CONSTRAINT `warranties_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
