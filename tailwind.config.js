module.exports = {
    content: [
        "./src/*.{html,js,riot}",
    ],

    theme: {
        extend: {
            fontFamily: {
                "quattrocento": ["Quattrocento", "sans-serif"] 
            },

            colors: {
                bakgrund: {
                    1: "#353B43",
                    2: "#242930",
                    3: "#1D2028"
                },
                bakgrundselement: "#33348E",

                rubriker: "#FFFFFF",
                underrubriker: "#AFBAC4",
                brodtext: "#737F8A",

                lankar: "#59BBF0",
                lankarhover: "#1784BA",
            }

        },

    },

    plugins: [
    ],
}
