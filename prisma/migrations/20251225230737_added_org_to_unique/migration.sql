/*
  Warnings:

  - A unique constraint covering the columns `[provider,providerUserId,organizationId]` on the table `Provider` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Provider_provider_providerUserId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Provider_provider_providerUserId_organizationId_key" ON "Provider"("provider", "providerUserId", "organizationId");
