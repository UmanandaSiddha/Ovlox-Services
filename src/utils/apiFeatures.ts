type PrismaDelegate<
    Where extends object,
    Include extends object,
    OrderBy extends object
> = {
    findMany(args: {
        where?: Where;
        include?: Include;
        orderBy?: OrderBy | OrderBy[];
        take?: number;
        skip?: number;
    }): Promise<any[]>;

    count(args: { where?: Where }): Promise<number>;
};

export type QueryString = {
    [key: string]: string | undefined | { [key: string]: string };
};

export class PrismaApiFeatures<
    Where extends object,
    Include extends object,
    OrderBy extends object,
    Delegate extends PrismaDelegate<Where, Include, OrderBy>
> {
    private model: Delegate;
    private queryStr: QueryString;

    private prismaQuery: {
        where?: Where;
        include?: Include;
        orderBy?: OrderBy | OrderBy[];
        take?: number;
        skip?: number;
    } = {};

    constructor(model: Delegate, queryStr: QueryString) {
        this.model = model;
        this.queryStr = queryStr;
    }

    /* -------------------- WHERE -------------------- */
    where(condition: Where): this {
        this.prismaQuery.where = {
            ...(this.prismaQuery.where ?? {}),
            ...condition,
        };
        return this;
    }

    /* -------------------- SEARCH -------------------- */
    search(fields: string[]): this {
        const keyword = this.queryStr.keyword;
        if (!keyword || fields.length === 0) return this;

        const orConditions = fields.map(field => ({
            [field]: {
                contains: keyword,
                mode: 'insensitive',
            },
        }));

        this.prismaQuery.where = {
            ...(this.prismaQuery.where ?? {}),
            OR: orConditions,
        } as Where;

        return this;
    }

    /* -------------------- FILTER -------------------- */
    filter(): this {
        const queryCopy = { ...this.queryStr };

        ['keyword', 'page', 'limit', 'sort', 'include'].forEach(
            key => delete queryCopy[key]
        );

        const filters: Record<string, any> = {};

        for (const key in queryCopy) {
            let value: any = queryCopy[key];

            if (typeof value === 'object' && value !== null) {
                const operator = Object.keys(value)[0];
                let operatorValue = value[operator];

                if (['gt', 'gte', 'lt', 'lte'].includes(operator)) {
                    operatorValue = Number(operatorValue);
                }

                if (['in', 'notIn'].includes(operator) && typeof operatorValue === 'string') {
                    operatorValue = operatorValue.split(',').map(v =>
                        isNaN(Number(v)) ? v : Number(v)
                    );
                }

                filters[key] = { [operator]: operatorValue };
            }

            else {
                if (value === 'true') value = true;
                else if (value === 'false') value = false;
                else if (!isNaN(Number(value))) value = Number(value);

                filters[key] = value;
            }
        }

        this.prismaQuery.where = {
            ...(this.prismaQuery.where ?? {}),
            ...filters,
        } as any;

        return this;
    }

    /* -------------------- SORT -------------------- */
    sort(defaultSort: OrderBy = { createdAt: 'desc' } as OrderBy): this {
        if (this.queryStr.sort) {
            const [field, order] = (this.queryStr.sort as string).split('_');
            this.prismaQuery.orderBy = { [field]: order } as OrderBy;
        } else {
            this.prismaQuery.orderBy = defaultSort;
        }
        return this;
    }

    /* -------------------- INCLUDE -------------------- */
    include(include: Include): this {
        this.prismaQuery.include = include;
        return this;
    }

    /* -------------------- PAGINATION -------------------- */
    pagination(defaultLimit = 10): this {
        const limit = Number(this.queryStr.limit) || defaultLimit;
        const page = Number(this.queryStr.page) || 1;

        this.prismaQuery.take = limit;
        this.prismaQuery.skip = (page - 1) * limit;

        return this;
    }

    /* -------------------- EXECUTE -------------------- */
    async execute() {
        const [results, totalCount] = await Promise.all([
            this.model.findMany(this.prismaQuery),
            this.model.count({ where: this.prismaQuery.where }),
        ]);

        return { results, totalCount };
    }
}