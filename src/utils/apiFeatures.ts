import { Prisma } from '@prisma/client';

type PrismaModelDelegate = {
    findMany: (args: any) => Promise<any[]>;
    count: (args: any) => Promise<number>;
};

export type QueryString = {
    [key: string]: string | undefined | { [key: string]: string };
};

export class PrismaApiFeatures<T extends PrismaModelDelegate> {
    private model: T;
    private queryStr: QueryString;
    private prismaQuery: {
        where: Prisma.JsonObject;
        take?: number;
        skip?: number;
        orderBy?: Prisma.JsonObject | Prisma.JsonArray;
        include?: Prisma.JsonObject;
    };

    constructor(model: T, queryStr: QueryString) {
        this.model = model;
        this.queryStr = queryStr;
        this.prismaQuery = {
            where: {},
        };
    }

    search(searchFields: string[]): this {
        const keyword = this.queryStr.keyword;
        if (keyword && searchFields.length > 0) {
            this.prismaQuery.where.OR = searchFields.map(field => ({
                [field]: {
                    contains: keyword,
                    mode: 'insensitive',
                },
            }));
        }
        return this;
    }

    filter(): this {
        const queryCopy = { ...this.queryStr };

        const removeFields = ["keyword", "page", "limit", "sort", "include"];
        removeFields.forEach((key) => delete queryCopy[key]);

        const filterObject: any = {};

        for (const key in queryCopy) {
            let value: any = queryCopy[key];
            if (typeof value === 'object' && value !== null) {
                const operator = Object.keys(value)[0];
                const operatorValue = value[operator];
                if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
                    filterObject[key] = { [operator]: Number(operatorValue) };
                } else {
                    //for in "in", "notIn", etc...
                    filterObject[key] = { [operator]: operatorValue };
                }
            } else {
                if (value === 'true') {
                    value = true;
                } else if (value === 'false') {
                    value = false;
                }
                else if (!isNaN(Number(value)) && String(value).trim() !== '') {
                    value = Number(value);
                }
                if (key.includes('.')) {
                    const [relation, field] = key.split('.');
                    if (!filterObject[relation]) {
                        filterObject[relation] = {};
                    }
                    filterObject[relation][field] = value;
                } else {
                    filterObject[key] = value;
                }
            }
        }

        this.prismaQuery.where = { ...this.prismaQuery.where, ...filterObject };

        return this;
    }

    pagination(defaultResultPerPage: number = 10): this {
        const resultPerPage = Number(this.queryStr.limit) || defaultResultPerPage;
        const currentPage = Number(this.queryStr.page) || 1;
        const skip = resultPerPage * (currentPage - 1);

        this.prismaQuery.take = resultPerPage;
        this.prismaQuery.skip = skip;

        return this;
    }

    sort(): this {
        if (this.queryStr.sort) {
            const [field, order] = (this.queryStr.sort as string).split('_');
            if (field && (order === 'asc' || order === 'desc')) {
                this.prismaQuery.orderBy = {
                    [field]: order,
                };
            }
        } else {
            this.prismaQuery.orderBy = {
                createdAt: 'desc',
            };
        }
        return this;
    }

    include(defaultIncludes?: Prisma.JsonObject): this {
        let nestedInclude: any = {};

        // If queryStr.include exists → build includes from it
        if (this.queryStr.include) {
            const includes = (this.queryStr.include as string).split(',');

            const buildNestedObject = (obj: any, path: string[]) => {
                const key = path.shift();
                if (!key) return;

                if (path.length === 0) {
                    obj[key] = true;
                } else {
                    if (!obj[key] || obj[key] === true) {
                        obj[key] = { include: {} };
                    }
                    buildNestedObject(obj[key].include, path);
                }
            };

            for (const include of includes) {
                const path = include.trim().split('.');
                buildNestedObject(nestedInclude, path);
            }
        }

        // Merge defaultIncludes (passed from service) with dynamic includes
        if (defaultIncludes) {
            nestedInclude = {
                ...nestedInclude,
                ...defaultIncludes,
            };
        }

        this.prismaQuery.include = nestedInclude;

        return this;
    }

    async execute(): Promise<{ results: any[], totalCount: number }> {
        const countQuery = { where: this.prismaQuery.where };

        const [results, totalCount] = await Promise.all([
            this.model.findMany(this.prismaQuery),
            this.model.count(countQuery),
        ]);

        return { results, totalCount };
    }
}