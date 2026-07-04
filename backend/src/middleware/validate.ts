import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

type Part = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      throw new ValidationError(result.error.flatten());
    }
    (req as any)[part] = result.data;
    next();
  };
}
