/**
 * Build config for electron renderer process
 */

import { sentryWebpackPlugin } from '@sentry/webpack-plugin'
import { TanStackRouterWebpack } from '@tanstack/router-plugin/webpack'
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
import path from 'path'
import TerserPlugin from 'terser-webpack-plugin'
import webpack from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import { merge } from 'webpack-merge'
import packageJson from '../../release/app/package.json'
import checkNodeEnv from '../scripts/check-node-env'
import baseConfig from './webpack.config.base'
import webpackPaths from './webpack.paths'

checkNodeEnv('production')

const inferredRelease = process.env.SENTRY_RELEASE || packageJson.version
const inferredDist = process.env.SENTRY_DIST || undefined

// Ensure downstream tooling sees consistent release/dist values
process.env.SENTRY_RELEASE = inferredRelease
if (inferredDist) {
  process.env.SENTRY_DIST = inferredDist
}

const configuration: webpack.Configuration = {
  devtool: 'source-map',

  mode: 'production',

  target: ['web', 'electron-renderer'],

  entry: [path.join(webpackPaths.srcRendererPath, 'index.tsx')],

  output: {
    path: webpackPaths.distRendererPath,
    publicPath: process.env.CHATBOX_BUILD_PLATFORM === 'web' ? '/' : './',
    filename: 'assets/js/[name].[contenthash].js', // JS文件放在assets/js目录下
    library: {
      type: 'umd',
    },
  },

  module: {
    rules: [
      {
        test: /\.s?(a|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?(a|c)ss$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader', 'postcss-loader', {
            loader: 'string-replace-loader',
            options: {
              search: /(\d+)dvh/g,
              replace: '$1vh',
            },
          }],
        exclude: /\.module\.s?(c|a)ss$/,
        sideEffects: true,
      },
      // Fonts
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/fonts/[name].[hash][ext]', // 字体资源放在assets/fonts目录下
        },
      },
      // Images
      {
        test: /\.(png|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/images/[name].[hash][ext]', // 图片资源放在assets/images目录下
        },
      },
      // SVG
      {
        test: /\.svg$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              prettier: false,
              svgo: false,
              svgoConfig: {
                plugins: [{ removeViewBox: false }],
              },
              titleProp: true,
              ref: true,
            },
          },
          'file-loader',
        ],
      },
    ],
  },

  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin(), new CssMinimizerPlugin()],
  },

  plugins: [
    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      DEBUG_PROD: false,
    }),

    TanStackRouterWebpack({
      target: 'react',
      autoCodeSplitting: process.env.CHATBOX_BUILD_PLATFORM === 'web' ? true : false,
      routesDirectory: './src/renderer/routes',
      generatedRouteTree: './src/renderer/routeTree.gen.ts',
    }),

    new MiniCssExtractPlugin({
      filename: '[name].[contenthash].css', // CSS文件放在assets/css目录下 - 又不放了，因为这样会导致非web端的字体文件引用路径出错
    }),

    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8889,
    }),

    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.join(
        webpackPaths.srcRendererPath,
        process.env.CHATBOX_BUILD_PLATFORM === 'web' ? 'index.web.ejs' : 'index.ejs'
      ),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true,
      },
      isBrowser: false,
      isDevelopment: false,
      favicon: path.join(webpackPaths.srcRendererPath, 'favicon.ico'),
    }),

    new webpack.DefinePlugin({
      'process.type': '"renderer"',
    }),
    // 禁用混淆，加快构建速度
    // new JavaScriptObfuscator({
    //   optionsPreset: 'default',
    //   // 太卡了
    //   // controlFlowFlattening: true,
    //   // controlFlowFlatteningThreshold: 0.1,

    //   // 默认的变量名混淆，可能被误报为恶意代码
    //   identifierNamesGenerator: 'mangled-shuffled',
    //   // 这些静态字符串混淆后，很可能被误报为恶意代码
    //   exclude: ['initial_data.ts', 'initial_data.js'],

    //   numbersToExpressions: true,
    //   // 保护前端代码不被偷到其他地方部署
    //   // 迁移过程中，暂时关闭保护
    //   // domainLock: ['localhost', ".chatboxai.app", ".chatboxai.com", ".chatboxapp.xyz", "chatbox-pro.pages.dev"],
    //   // domainLockRedirectUrl: 'https://chatboxai.app',
    //   sourceMap: true,
    // }),
    
    process.env.SENTRY_AUTH_TOKEN && sentryWebpackPlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: 'sentry',
        project: 'chatbox',
        url: 'https://sentry.midway.run/',
        release: {
          name: inferredRelease,
          ...(inferredDist ? { dist: inferredDist } : {}),
        },
      }),
  ],
}

export default merge(baseConfig, configuration)
