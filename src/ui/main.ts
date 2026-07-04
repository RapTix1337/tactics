import { APP_NAME } from '../shared';

// Plain-DOM toolchain proof (E1.1); the React mount replaces this in E3.2.
const root = document.getElementById('root');
if (root !== null) {
  const heading = document.createElement('h1');
  heading.textContent = `${APP_NAME} — walking skeleton`;
  root.append(heading);
}
