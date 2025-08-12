const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env) => ({
  entry: './src/index.js',
  output: {
    path: env.production 
      ? path.resolve(__dirname, 'build')
      : path.resolve(__dirname, 'build'),
    filename: 'bundle.js',
    clean: true,
  },
  optimization: {
    minimize: env.production,
    minimizer: [new TerserPlugin()],
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'],
          },
        },
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    alias: {
      '@components': path.resolve(__dirname, 'src/components'),
      '@context': path.resolve(__dirname, 'src/context')
    }
  },
  mode: env.production ? 'production' : 'development',
});