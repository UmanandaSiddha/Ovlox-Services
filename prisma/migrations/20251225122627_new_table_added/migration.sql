-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN     "isSelected" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ExternalProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "config" JSONB,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_provider_providerUserId_key" ON "Provider"("provider", "providerUserId");

-- CreateIndex
CREATE INDEX "Integration_type_externalAccountId_idx" ON "Integration"("type", "externalAccountId");

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
