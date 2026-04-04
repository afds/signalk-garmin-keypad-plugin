const path = require('path')
const { ModuleFederationPlugin } = require('webpack').container

const packageName = 'signalk-garmin-keypad'
const safeName = packageName.replace(/[-@/]/g, '_')

module.exports = {
  entry: './src/main',
  output: {
    path: path.resolve(__dirname, '../public'),
    publicPath: `/${packageName}/`,
    clean: true
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  plugins: [
    new ModuleFederationPlugin({
      name: safeName,
      library: { type: 'var', name: safeName },
      filename: 'remoteEntry.js',
      exposes: {
        './AppPanel': './src/AppPanel'
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: false,
          eager: false,
          import: false
        },
        'react-dom': {
          singleton: true,
          requiredVersion: false,
          eager: false,
          import: false
        }
      }
    })
  ]
}
