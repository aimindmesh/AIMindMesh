import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/index.ts',
    output: [
        {
            file: 'dist/plugin.cjs.js',
            format: 'cjs',
            sourcemap: true
        },
        {
            file: 'dist/plugin.js',
            format: 'iife',
            name: 'capacitorSpeakerEmbedding',
            globals: {
                '@capacitor/core': 'capacitorExports'
            },
            sourcemap: true
        }
    ],
    external: ['@capacitor/core'],
    plugins: [typescript()]
};
