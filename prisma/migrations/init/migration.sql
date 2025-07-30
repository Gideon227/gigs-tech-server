-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobId" TEXT DEFAULT '',
    "title" TEXT DEFAULT '',
    "description" TEXT DEFAULT '',
    "location" TEXT DEFAULT '',
    "country" TEXT DEFAULT '',
    "state" TEXT DEFAULT '',
    "city" TEXT DEFAULT '',
    "jobType" TEXT DEFAULT 'fullTime',
    "salary" TEXT DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experienceLevel" TEXT DEFAULT 'experienced',
    "currency" TEXT DEFAULT '',
    "applicationUrl" TEXT DEFAULT '',
    "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalStatus" TEXT,
    "brokenLink" BOOLEAN DEFAULT false,
    "jobStatus" TEXT DEFAULT 'active',
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "workSettings" TEXT,
    "roleCategory" TEXT DEFAULT '',
    "qualifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyLogo" TEXT DEFAULT '',
    "companyName" TEXT,
    "ipBlocked" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "minSalary" INTEGER DEFAULT 0,
    "maxSalary" INTEGER DEFAULT 0,
    "postedDate" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "category" TEXT,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "activeScrapers" INTEGER NOT NULL,
    "totalJobsScraped" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScraperRun_pkey" PRIMARY KEY ("id")
);

