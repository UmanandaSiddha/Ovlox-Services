/*
  Warnings:

  - The `status` column on the `IngestionJob` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `Job` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRY');

-- AlterTable
ALTER TABLE "IngestionJob" DROP COLUMN "status",
ADD COLUMN     "status" "IngestionStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "status",
ADD COLUMN     "status" "JobStatus" NOT NULL DEFAULT 'PENDING';
