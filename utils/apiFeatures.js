// utils/apiFeatures.js
const { Prisma } = require('@prisma/client');

class APIFeatures {
  /**
   * @param {Object} queryParams  req.query  (e.g. { status: 'open', 'salary[gt]': '50000', page: '2', limit: '10' })
   */
  constructor(queryParams) {
    this.queryParams = { ...queryParams };
    this.options = {
      where: {},
      orderBy: [],
      select: {},
      skip: 0,
      take: 10,
    };
    this.hasSelect = false;
  }

  filter() {
    // Copy and exclude special fields
    const queryObj = { ...this.queryParams };
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach((el) => delete queryObj[el]);

    const where = {};

    // Handle jobType filtering (e.g., ?jobType=remote)
    if (queryObj.jobType) {
      where.jobType = queryObj.jobType;
    }

    // Handle experienceLevel filtering (e.g., ?experienceLevel=senior)
    if (queryObj.experienceLevel) {
      where.experienceLevel = queryObj.experienceLevel;
    }

    // Handle salary range (e.g., ?minSalary=30000&maxSalary=100000)
    if (queryObj.minSalary || queryObj.maxSalary) {
      where.salary = {};
      if (queryObj.minSalary) {
        where.salary.gte = Number(queryObj.minSalary);
      }
      if (queryObj.maxSalary) {
        where.salary.lte = Number(queryObj.maxSalary);
      }
    }

    this.options.where = where;

    // Build Prisma where clause
    // For comparators: salary[gt]=50000 → { salary: { gt: 50000 } }
    Object.keys(queryObj).forEach((field) => {
      const value = queryObj[field];

      // Match patterns like: field[gt], field[gte], field[lt], field[lte], field[ne]
      const match = field.match(/(\w+)\[(gte|gt|lte|lt|ne)\]/);
      if (match) {
        const key = match[1];       // e.g. 'salary'
        const operator = match[2];  // e.g. 'gt'
        // Map to Prisma's filter operators
        const opMap = {
          gt: 'gt',
          gte: 'gte',
          lt: 'lt',
          lte: 'lte',
          ne: 'not',
        };

        if (!where[key]) {
          where[key] = {};
        }
        // Note: For 'ne', Prisma uses `not` as a special object/value 
        // If value is a primitive, `not: value` means not equal. 
        // But if you want `not: { ... }`, you can do nested. Here we do primitive.
        if (opMap[operator] === 'not') {
          where[key] = { not: this._parseValue(key, value) };
        } else {
          // e.g. { salary: { gt: 50000 } }
          where[key][opMap[operator]] = this._parseValue(key, value);
        }
      } else {
        // Simple equality filter: `?status=open`
        // We must coerce value to correct type based on field name; 
        // default is string. For numeric fields like salary, cast to float.
        where[field] = this._parseValue(field, value);
      }
    });

    return this;
  }

  sort() {
    if (this.queryParams.sort) {
      // e.g. ?sort=salary,-createdAt  →  orderBy: [ { salary: 'asc' }, { createdAt: 'desc' } ]
      const sortBy = this.queryParams.sort.split(',');
      this.options.orderBy = sortBy.map((field) => {
        if (field.startsWith('-')) {
          return { [field.slice(1)]: 'desc' };
        } else {
          return { [field]: 'asc' };
        }
      });
    } else {
      // Default sort by newest (createdAt desc)
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
    // e.g. ?page=2&limit=10
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
    const numericFields = ['salary'];
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



//Example: 
// example url: /jobs?status=open&salary[gt]=50000&sort=-salary&fields=title,salary&page=2&limit=5
//
// Resulting Prisma Query:
// {
//   where: {
//     status: 'open',
//     salary: { gt: 50000 }
//   },
//   orderBy: [
//     { salary: 'desc' }
//   ],
//   select: {
//     title: true,
//     salary: true
//   },
//   skip: 5,
//   take: 5
// }
