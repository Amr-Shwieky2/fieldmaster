-- DropForeignKey
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT "payroll_adjustments_payroll_item_id_fkey";

-- AlterTable
ALTER TABLE "payroll_adjustments" ADD COLUMN     "business_month" TEXT NOT NULL,
ADD COLUMN     "organization_id" UUID NOT NULL,
ADD COLUMN     "worker_profile_id" UUID NOT NULL,
ALTER COLUMN "payroll_item_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "payroll_adjustments_organization_id_worker_profile_id_busin_idx" ON "payroll_adjustments"("organization_id", "worker_profile_id", "business_month");

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_item_id_fkey" FOREIGN KEY ("payroll_item_id") REFERENCES "payroll_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

