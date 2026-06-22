import {PrismaAdapter} from "@auth/prisma-adapter"
import PrismaClient from "@repo/db/client"
import {NextAuthOptions} from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GithubProvider from "next-auth/providers/github";

export const authOptions: NextAuthOptions = {
    adapter: PrismaAdapter(PrismaClient),
    providers:[

        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || ""
        }),
        GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID || "",
            clientSecret: process.env.GITHUB_CLIENT_SECRET || ""
        }),

        CredentialsProvider({
            name: "Phone OTP ",
            credentials: {
                phone: { label: "Phone Number", type: "text", placeholder: "Enter your phone number" },
                otpToken: { label: "OTP", type: "text", placeholder: "Enter the OTP sent to your phone" },
            },
            async authorize(credentials) {
                if (!credentials?.phone || !credentials?.otpToken) {
                    return console.log("Missing phone or OTP token"), null;
                }

                // Replace this with real OTP verification logic.
                if (credentials.otpToken !== "123456") {
                    return console.log("Invalid OTP token"), null;
                }

                return {
                    id: credentials.phone,
                    name: credentials.phone,
                };
            },
        })
    ],
    session: {
        strategy: "jwt",
    },

    callbacks:{
        async jwt({ token, user }) {
            if (user) token.sub = user.id
            return token
        },
        async session({session, token}) {
            if (session.user) {
                session.user.id = token.sub || "";
            }
            return session;
        }
    }
}