const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Dotenv = require('dotenv-webpack');
const { ModuleFederationPlugin } = require('webpack').container;
const deps = require('./package.json').dependencies;

module.exports = {
  entry: './src/index.tsx',
  output: { path: path.resolve(__dirname, 'dist'), publicPath: 'auto' },
  resolve: { extensions: ['.tsx', '.ts', '.js'] },
  module: { rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }] },
  devServer: { port: 3017, historyApiFallback: true },
  plugins: [
    new Dotenv(),
    new ModuleFederationPlugin({
      name: 'yardMap',
      filename: 'remoteEntry.js',
      exposes: {
        './YardMap': './src/mf/YardMapRemote.tsx',
        './MovePlanner': './src/mf/MovePlannerRemote.tsx',
        './GateJournal': './src/mf/GateJournalRemote.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: deps.react },
        'react-dom': { singleton: true, requiredVersion: deps['react-dom'] },
        mobx: { singleton: true },
      },
    }),
    new HtmlWebpackPlugin({ template: './public/index.html' }),
  ],
};
