const { Prisma } = require('@prisma/client');
const Fuse = require('fuse.js')
const prisma = require('../config/prisma')

class APIFeatures {
  constructor(queryParams) {
    this.queryParams = { ...queryParams };
    this.options = {
      where: {},
      orderBy: [],
      select: {},
      // skip: 0,
      // take: 10,
    };
    this.hasSelect = false;
    this.fuzzy = {
      keyword: null,
      location: null,
      enabled: false,
    };
  }

  async filter() {
    const queryObj = { ...this.queryParams };
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach((el) => delete queryObj[el]);

    const where = {};

    // ---------------------------------------------------------
    // ✅ DEFAULT: Only apply 30-days filter when NO datePosted
    // ---------------------------------------------------------
    const hasUserDefinedDate = Boolean(queryObj.datePosted);

    if (!hasUserDefinedDate) {
      const default30 = new Date();
      default30.setDate(default30.getDate() - 30);

      where.postedDate = { gte: default30 };
    }

    // Exact match filters
    ['country', 'state', 'city'].forEach((field) => {
      if (queryObj[field]) {
        where[field] = {
          equals: queryObj[field].trim(),
          mode: 'insensitive',
        };
      }
    });

    // Keyword search across title + description + companyName
    if (queryObj.keyword) {
      const keyword = String(queryObj.keyword).trim();
      if (keyword.length > 0) {
        this.fuzzy.keyword = keyword;
        this.fuzzy.enabled = true;

        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            {
              title: { contains: keyword, mode: 'insensitive' },
            },
            {
              description: { contains: keyword, mode: 'insensitive' },
            },
            {
              companyName: { contains: keyword, mode: 'insensitive' },
            },
          ],
        });
      }
    }

    // Location fuzzy filter
    if (queryObj.location) {
      const loc = String(queryObj.location).trim();
      if (loc.length > 0) {
        this.fuzzy.location = loc;
        this.fuzzy.enabled = true;

        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { country: { contains: loc, mode: 'insensitive' } },
            { state: { contains: loc, mode: 'insensitive' } },
            { city: { contains: loc, mode: 'insensitive' } },
          ],
        });
      }
    }

    if (queryObj.roleCategory) where.roleCategory = queryObj.roleCategory;
    if (queryObj.jobStatus) where.jobStatus = queryObj.jobStatus;

    // Experience level
    if (queryObj.experienceLevel) {
      where.experienceLevel = queryObj.experienceLevel;
    }

    // Skills (array)
    if (queryObj.skills) {
      if (Array.isArray(queryObj.skills)) {
        where.skills = { hasSome: queryObj.skills };
      } else if (typeof queryObj.skills === 'string' && queryObj.skills.includes(',')) {
        where.skills = { hasSome: queryObj.skills.split(',') };
      } else {
        where.skills = { has: queryObj.skills };
      }
    }

    // JobType (string or array)
    if (queryObj.jobType) {
      if (Array.isArray(queryObj.jobType)) {
        where.jobType = { in: queryObj.jobType };
      } else {
        where.jobType = { equals: queryObj.jobType };
      }
    }

    // Work settings
    if (queryObj.workSettings) {
      if (Array.isArray(queryObj.workSettings)) {
        where.workSettings = { in: queryObj.workSettings };
      } else {
        where.workSettings = { equals: queryObj.workSettings };
      }
    }

    // Booleans
    const booleanFields = ['isActive'];
    booleanFields.forEach((key) => {
      if (queryObj[key] !== undefined) {
        where[key] = queryObj[key] === 'true';
      }
    });

    // Salary range
    if (queryObj.minSalary || queryObj.maxSalary) {
      if (queryObj.minSalary !== undefined && queryObj.minSalary !== '') {
        where.minSalary = { gte: parseFloat(queryObj.minSalary) };
      }
      if (queryObj.maxSalary !== undefined && queryObj.maxSalary !== '') {
        where.maxSalary = { lte: parseFloat(queryObj.maxSalary) };
      }
    }

    // ---------------------------------------------------------
    // USER SPECIFIED datePosted OVERRIDES DEFAULT 30 DAYS
    // ---------------------------------------------------------
    if (hasUserDefinedDate) {
      const now = new Date();
      let postedAfter;

      switch (queryObj.datePosted) {
        case 'today':
          postedAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'last_3_days':
          postedAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
          break;
        case 'last_7_days':
          postedAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
          break;
        case 'last_15_days':
          postedAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 15);
          break;
      }

      if (postedAfter) {
        where.postedDate = { gte: postedAfter };
      }
    }

    // Comparator operators
    Object.keys(queryObj).forEach((field) => {
      const value = queryObj[field];
      const match = field.match(/(\w+)\[(gte|gt|lte|lt|ne)\]/);
      if (match) {
        const key = match[1];
        const operator = match[2];
        const opMap = { gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', ne: 'not' };

        if (!where[key]) where[key] = {};

        if (opMap[operator] === 'not') {
          where[key] = { not: this._parseValue(key, value) };
        } else {
          where[key][opMap[operator]] = this._parseValue(key, value);
        }
      }
    });

    this.options.where = where;
    return this;
  }

  sort() {
    if (this.queryParams.sort) {
      const sortBy = this.queryParams.sort.split(',');
      this.options.orderBy = sortBy.map((field) => {
        let direction = 'asc';

        if (field.startsWith('-')) {
          direction = 'desc';
          field = field.slice(1);
        }

        return { [field]: direction };
      });
    } else {
      this.options.orderBy = [{ postedDate: 'desc' }];
    }
    return this;
  }

  limitFields() {
    if (this.queryParams.fields) {
      const fields = this.queryParams.fields.split(',');
      fields.forEach((f) => {
        this.options.select[f] = true;
      });
      this.hasSelect = true;
    }
    return this;
  }

  paginate() {
    const page = parseInt(this.queryParams.page, 10) || 1;
    const limit = parseInt(this.queryParams.limit, 10) || 10;
    const skip = (page - 1) * limit;

    this.options.skip = skip;
    this.options.take = limit;
    return this;
  }

  _parseValue(field, value) {
    const numericFields = ['minSalary', 'maxSalary'];
    const booleanFields = ['isActive'];
    const dateFields = ['createdAt'];

    if (numericFields.includes(field)) return parseFloat(value);
    if (booleanFields.includes(field)) return value === 'true';
    if (dateFields.includes(field)) return new Date(value);

    return value;
  }

  build() {
    if (!this.hasSelect) {
      delete this.options.select;
    }
    if (this.options.orderBy.length === 0) {
      delete this.options.orderBy;
    }
    return this.options;
  }
}

module.exports = APIFeatures;
