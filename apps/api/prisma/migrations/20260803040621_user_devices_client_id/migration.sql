-- AlterTable
ALTER TABLE "user_devices" ADD COLUMN     "client_device_id" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_client_device_id_key" ON "user_devices"("user_id", "client_device_id");

