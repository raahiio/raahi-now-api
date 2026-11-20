import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Routes Express actually serves, as "METHOD /path/{id}". */
export function registeredRoutes(app: INestApplication): string[] {
  const router = (app.getHttpAdapter().getInstance() as { router: { stack: Layer[] } }).router;
  const out: string[] = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${path}`);
  }
  return out;
}

/** Real routes (minus test-only and docs ones) that the document does not describe. */
export function missingRoutes(app: INestApplication, doc: OpenAPIObject): string[] {
  const documented = new Set(
    Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${path}`),
    ),
  );
  return registeredRoutes(app).filter(
    (r) => !/ \/v1\/__test(\/|$)/.test(r) && !/ \/v1\/docs(\/|$|-json)/.test(r) && !documented.has(r),
  );
}
