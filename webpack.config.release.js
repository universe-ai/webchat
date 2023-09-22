const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const webpack = require("webpack");

module.exports = {
    node: {
        global: false
    },
    mode: "production",
    entry: "./src/main.js",
    output: {
        path: path.resolve(__dirname, "release"),
        filename: "main.js",
    },
    plugins: [
        new MiniCssExtractPlugin({
            filename: "main.css"
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
    ],
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: [
                    MiniCssExtractPlugin.loader,
                    { loader: 'css-loader', options: { importLoaders: 1 } },
                    //{ loader: 'resolve-url-loader' },
                    { loader: 'postcss-loader', options: { sourceMap: true } },
                ],
            },
            {
                test: /\.riot$/,
                exclude: /node_modules/,
                use: [{
                    loader: "@riotjs/webpack-loader",
                    options: {
                        hot: false, // set it to true if you are using hmr
                        // add here all the other @riotjs/compiler options riot.js.org/compiler
                        // template: 'pug' for example
                        scopedCss: true
                    }
                }]
            },
            {
                test: /\.(png|svg|jpg|jpeg|gif|woff|woff2|eot|ttf|otf)$/i,
                type: "asset/resource",
            },
        ],
    },
    resolve: {
        fallback: {
            crypto: require.resolve("crypto-browserify"),
            path:   require.resolve("path-browserify"),
            stream: require.resolve("stream-browserify"),
            buffer: require.resolve("buffer/")
        }
    }
};
