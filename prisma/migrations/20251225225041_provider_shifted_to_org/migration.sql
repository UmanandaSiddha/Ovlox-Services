/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Provider` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Provider` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Provider` table. All the data in the column will be lost.
  - Added the required column `organizationId` to the `Provider` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Provider" DROP CONSTRAINT "Provider_userId_fkey";

-- AlterTable
ALTER TABLE "Provider" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
DROP COLUMN "userId",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
