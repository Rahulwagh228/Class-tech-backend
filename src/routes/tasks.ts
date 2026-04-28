import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { CreateTaskInput, UpdateTaskInput } from '../repositories/taskRepository.js';
import { InMemoryTaskRepository } from '../repositories/taskRepository.js';
import { TaskService } from '../services/taskService.js';

const taskSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  status: z.enum(['todo', 'in-progress', 'done']).optional()
});

const partialTaskSchema = taskSchema.partial().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided'
});

const repository = new InMemoryTaskRepository();
const taskService = new TaskService(repository);

export const tasksRouter = Router();

tasksRouter.get('/', (_request, response) => {
  response.json({ data: taskService.listTasks() });
});

tasksRouter.get('/:id', (request, response, next) => {
  try {
    const task = taskService.getTaskById(request.params.id);
    response.json({ data: task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/', (request, response, next) => {
  try {
    const input = taskSchema.parse(request.body) satisfies CreateTaskInput;
    const task = taskService.createTask(input);
    response.status(201).json({ data: task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.patch('/:id', (request, response, next) => {
  try {
    const input = partialTaskSchema.parse(request.body) satisfies UpdateTaskInput;
    const task = taskService.updateTask(request.params.id, input);
    response.json({ data: task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.delete('/:id', (request, response, next) => {
  try {
    taskService.deleteTask(request.params.id);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

tasksRouter.use((error: unknown, _request: Request, _response: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) {
    next(new AppError(error.issues[0]?.message ?? 'Validation failed', 400));
    return;
  }

  next(error);
});