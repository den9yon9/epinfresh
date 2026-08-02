export type ErrorContract<E extends string> = { [K in E]: { status: number; message: string } }
