const { Prisma } = require('@prisma/client');

class APIFeatures {
  /**
   * @param {Object} queryParams - e.g. { page: '2', limit: '10', keyword: 'react' }
   */
  constructor(queryParams) {
    this.queryParams = { ...queryParams };
    this.options = {
      where: {},
      orderBy: [],
      select: {},
      // skip / take set in paginate()
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

    // Default window: last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.postedDate = { gte: thirtyDaysAgo };

    // Default status: active (allow override via ?jobStatus=expired, etc.)
    if (queryObj.jobStatus) {
      where.jobStatus = queryObj.jobStatus;
    } else {
      where.jobStatus = 'active';
    }

    // Exact match filters (case-insensitive where applicable)
    ['country', 'state', 'city'].forEach((field) => {
      if (queryObj[field]) {
        where[field] = { equals: String(queryObj[field]).trim(), mode: 'insensitive' };
      }
    });

    if (queryObj.roleCategory) where.roleCategory = queryObj.roleCategory;
    if (queryObj.experienceLevel) where.experienceLevel = queryObj.experienceLevel;

    // Skills: array column
    if (queryObj.skills) {
      if (Array.isArray(queryObj.skills)) {
        where.skills = { hasSome: queryObj.skills };
      } else if (typeof queryObj.skills === 'string' && queryObj.skills.includes(',')) {
        where.skills = { hasSome: queryObj.skills.split(',').map(s => s.trim()).filter(Boolean) };
      } else {
        where.skills = { has: queryObj.skills };
      }
    }

    // jobType: string (allow multi)
    if (queryObj.jobType) {
      if (Array.isArray(queryObj.jobType)) {
        where.jobType = { in: queryObj.jobType };
      } else if (typeof queryObj.jobType === 'string' && queryObj.jobType.includes(',')) {
        where.jobType = { in: queryObj.jobType.split(',').map(s => s.trim()).filter(Boolean) };
      } else {
        where.jobType = { equals: queryObj.jobType };
      }
    }

    // workSettings: string (allow multi)
    if (queryObj.workSettings) {
      if (Array.isArray(queryObj.workSettings)) {
        where.workSettings = { in: queryObj.workSettings };
      } else if (typeof queryObj.workSettings === 'string' && queryObj.workSettings.includes(',')) {
        where.workSettings = { in: queryObj.workSettings.split(',').map(s => s.trim()).filter(Boolean) };
      } else {
        where.workSettings = { equals: queryObj.workSettings };
      }
    }

    // Boolean fields
    const booleanFields = ['isActive'];
    booleanFields.forEach((key) => {
      if (queryObj[key] !== undefined) {
        where[key] = String(queryObj[key]) === 'true';
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

    // Keyword (broad filter in DB; exact ordering handled by Fuse when fuzzy is on)
    if (queryObj.keyword) {
      const keyword = String(queryObj.keyword).trim();
      if (keyword) {
        this.fuzzy.keyword = keyword;
        this.fuzzy.enabled = true;
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { title: { contains: keyword, mode: 'insensitive' } },
            { description: { contains: keyword, mode: 'insensitive' } },
            { companyName: { contains: keyword, mode: 'insensitive' } },
          ],
        });
      }
    }

    // Location (broad OR contains)
    if (queryObj.location) {
      const loc = String(queryObj.location).trim();
      if (loc) {
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

    // datePosted (overrides the default postedDate window)
    if (queryObj.datePosted) {
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
        default:
          break;
      }
      if (postedAfter) {
        where.postedDate = { gte: postedAfter };
      }
    }

    // Generic comparators like salary[gt]=50000
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
      this.options.orderBy = sortBy.map((f) => {
        let field = f;
        let direction = 'asc';
        if (field.startsWith('-')) {
          direction = 'desc';
          field = field.slice(1);
        }
        if (field === 'datePosted') field = 'postedDate';
        return { [field]: direction };
      });
    } else {
      this.options.orderBy = [{ postedDate: 'desc' }];
    }
    return this;
  }

  limitFields() {
    if (this.queryParams.fields) {
      const fields = this.queryParams.fields.split(',').map(s => s.trim()).filter(Boolean);
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

    // expose for caller (useful for in-memory pagination/fuse)
    this.options._page = page;
    this.options._limit = limit;

    return this;
  }

  _parseValue(field, value) {
    const numericFields = ['minSalary', 'maxSalary'];
    const booleanFields = ['isActive'];
    const dateFields = ['createdAt', 'postedDate', 'updatedAt'];

    if (numericFields.includes(field)) return parseFloat(value);
    if (booleanFields.includes(field)) return String(value) === 'true';
    if (dateFields.includes(field)) return new Date(value);
    return value;
  }

  build() {
    if (!this.hasSelect) {
      delete this.options.select;
    }
    if (!this.options.orderBy || this.options.orderBy.length === 0) {
      delete this.options.orderBy;
    }
    return this.options;
  }
}

module.exports = APIFeatures;
