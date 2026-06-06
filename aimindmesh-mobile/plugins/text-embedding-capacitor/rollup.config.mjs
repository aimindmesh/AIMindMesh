import typescript from '@rollup/plugin-typescript';

export default [
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/plugin.cjs.js',
            format: 'cjs',
            sourcemap: true,
            inlineDynamicImports: true
        },
        external: ['@capacitor/core'],
        plugins: [typescript()]
    },
    {
        input: 'src/index.ts',
        output: {
            file: 'dist/plugin.js',
            format: 'iife',
            name: 'capacitorTextEmbedding',
            globals: {
                '@capacitor/core': 'capacitorExports'
            },
            sourcemap: true,
            inlineDynamicImports: true
        },
        external: ['@capacitor/core'],
        plugins: [typescript()]
    }
];
