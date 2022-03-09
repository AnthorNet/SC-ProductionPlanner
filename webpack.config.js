'use strict';

const webpack                       = require('webpack');
const path                          = require('path');

const SentryWebpackPlugin           = require('@sentry/webpack-plugin');
const TerserPlugin                  = require("terser-webpack-plugin");

module.exports = env => {
    return {
        mode            : 'production',
        devtool         : 'hidden-source-map',
        performance     : { hints: false },
        context         : path.resolve(__dirname, 'src'),
        entry           : {
            SCPP            : './SCPP.js'
        },

        output          : {
            path            : path.resolve(__dirname, 'build'),
            filename        : './[name].js'
        },
        optimization    : {
            minimize        : true,
            minimizer       : [
                new TerserPlugin({
                    test: /\.js(\?.*)?$/i,
                    terserOptions: {keep_classnames: true}
                })
            ]
        },

        plugins: [
            // Send new release to Sentry
            new SentryWebpackPlugin({
                // sentry-cli configuration
                url: env.SENTRY_URL,
                authToken: env.SENTRY_AUTH_TOKEN,
                org: "sentry",
                project: "satisfactory-calculator",

                // webpack specific configuration
                validate: true,
                include: path.resolve(__dirname, 'build'),
                ignore: ['node_modules', 'webpack.config.js']
            })
        ]
    };
};