import 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'twisty-player': any;
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'twisty-player': any;
    }
  }
}
