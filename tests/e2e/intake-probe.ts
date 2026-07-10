import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';

// Loopback probes for the GSI intake, shared by the test-mode evidence spec
// (E20.1) and the smoke-scenario suite (E20.2).

/**
 * POSTs a body to the local intake and resolves the response status code;
 * 0 while nothing listens — which keeps an `expect.poll` retrying.
 */
export function postToIntake(port: number, body: string): Promise<number> {
  return new Promise((resolve) => {
    const clientRequest = httpRequest(
      { host: '127.0.0.1', port, method: 'POST', path: '/' },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    clientRequest.on('error', () => resolve(0));
    clientRequest.end(body);
  });
}

/** Whether the port is currently bindable on loopback. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}
