// utils/apiFeatures.js
const { Prisma } = require('@prisma/client');

const prisma = require('../config/prisma')

async function buildLocationFilter(prisma, loc) {
  // First, get all matching location strings
  const matches = await prisma.$queryRaw`
    SELECT DISTINCT country, state, city
    FROM jobs
    WHERE similarity(country, ${loc}) > 0.3
       OR similarity(state, ${loc}) > 0.3
       OR similarity(city, ${loc}) > 0.3
  `;

  // Flatten all matches into arrays
  const countries = [];
  const states = [];
  const cities = [];

  matches.forEach(row => {
    if (row.country) countries.push(row.country);
    if (row.state) states.push(row.state);
    if (row.city) cities.push(row.city);
  });

  const OR = [];
  if (countries.length) OR.push({ country: { in: countries, mode: 'insensitive' } });
  if (states.length) OR.push({ state: { in: states, mode: 'insensitive' } });
  if (cities.length) OR.push({ city: { in: cities, mode: 'insensitive' } });

  return OR.length ? { OR } : {};
}


class APIFeatures {
  /**
   * @param {Object} queryParams  req.query  (e.g. {'salary[gt]': '50000', page: '2', limit: '10' })
   */
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
  }

  async filter() {
    // Copy and exclude special fields
    const queryObj = { ...this.queryParams };
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach((el) => delete queryObj[el]);

    const where = {};

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.postedDate = { gte: thirtyDaysAgo };

    // Exact match filters
    ['country', 'state', 'city'].forEach((field) => {
      if (queryObj[field]) {
        where[field] = {
          equals: queryObj[field].trim(),
          mode: 'insensitive',
        };
      }
    });

    // Keyword search across title and description
    if (queryObj.keyword) {
      const keyword = queryObj.keyword.trim();
      if (keyword.length > 0) {
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            {
              title: {
                contains: keyword,
                mode: 'insensitive',
              },
            },
            {
              description: {
                contains: keyword,
                mode: 'insensitive',
              },
            },
            {
              companyName: {
                contains: keyword,
                mode: 'insensitive',
              },
            },
          ],
        });
      }
    }

    // Handle location filtering
    if (queryObj.location) {
      const loc = queryObj.location.trim();
      const locationFilter = await buildLocationFilter(prisma, loc);
      Object.assign(where, locationFilter);
    }

    if (queryObj.roleCategory) where.roleCategory = queryObj.roleCategory;
    if (queryObj.jobStatus) where.jobStatus = queryObj.jobStatus;

    // Handle experienceLevel filtering (e.g., ?experienceLevel=senior)
    if (queryObj.experienceLevel) {
      where.experienceLevel = queryObj.experienceLevel;
    }

    // For skills (Array column in DB)
    if (queryObj.skills) {
      if (Array.isArray(queryObj.skills)) {
        where.skills = { hasSome: queryObj.skills };
      } else if (typeof queryObj.skills === 'string' && queryObj.skills.includes(',')) {
        where.skills = { hasSome: queryObj.skills.split(',') };
      } else {
        where.skills = { has: queryObj.skills };
      }
    }

    // For jobType (Single string column in DB)
    // if (queryObj.jobType) {
    //   where.jobType = queryObj.jobType;
    // }
    if (queryObj.jobType) {
      if (Array.isArray(queryObj.jobType)) {
        where.jobType = { in: queryObj.jobType };
      } else {
        where.jobType = { equals: queryObj.jobType };
      }
    }

    // For workSettings (Single string column in DB)
    // if (queryObj.workSettings) {
    //   where.workSettings = queryObj.workSettings;
    // }

    if (queryObj.workSettings) {
      if (Array.isArray(queryObj.workSettings)) {
        where.workSettings = { in: queryObj.workSettings };
      } else {
        where.workSettings = { equals: queryObj.workSettings };
      }
    }


    // Boolean fields (e.g. ?isActive=true)
    const booleanFields = ['isActive'];
    booleanFields.forEach((key) => {
      if (queryObj[key] !== undefined) {
        where[key] = queryObj[key] === 'true';
      }
    });

    // Salary Range
    // Handle salary range (e.g., ?minSalary=30000&maxSalary=100000)
    if (queryObj.minSalary || queryObj.maxSalary) {
      if (queryObj.minSalary !== undefined && queryObj.minSalary !== null && queryObj.minSalary !== '') {
        where.minSalary = { gte: parseFloat(queryObj.minSalary) };
      }
      if (queryObj.maxSalary !== undefined && queryObj.maxSalary !== null && queryObj.maxSalary !== '') {
        where.maxSalary = { lte: parseFloat(queryObj.maxSalary) };
      }
    }

     // Date posted logic
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
      }
      if (postedAfter) {
        where.postedDate = { gte: postedAfter };
      }
    }

    // Build Prisma where clause
    // For comparators: salary[gt]=50000 → { salary: { gt: 50000 } }
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
        if (field === 'datePosted') field = 'postedDate';
        if (field.startsWith('-')) {
          return { [field.slice(1)]: 'desc' };
        } else {
          return { [field]: 'asc' };
        }
      });
    } else {
      this.options.orderBy = [{ createdAt: 'desc' }];
    }
    return this;
  }

  limitFields() {
    if (this.queryParams.fields) {
      // e.g. ?fields=title,company,salary → select: { title: true, company: true, salary: true }
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

  /**
   * Parse a string value into the correct type based on field name.
   * - If it's a numeric field (salary), parse as float
   * - Otherwise leave as string
   */
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
    // If select is empty, Prisma will select all fields by default.
    if (!this.hasSelect) {
      delete this.options.select;
    }
    // If no orderBy specified, delete it so Prisma defaults to no specific ordering
    if (this.options.orderBy.length === 0) {
      delete this.options.orderBy;
    }
    return this.options;
  }
}

module.exports = APIFeatures;