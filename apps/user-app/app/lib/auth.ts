import {PrismaAdapter} from "@auth/prisma-adapter"
import PrismaClient from "@repo/db/client"
import {NextAuthOptions} from "next-auth"
import jwt from "jsonwebtoken"
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
            name: "Phone OTP",
            credentials: {
                phone: { label: "Phone Number", type: "text", placeholder: "Enter your phone number" },
                otpToken: { label: "OTP", type: "text", placeholder: "Enter the OTP sent to your phone" },
            },
            async authorize(credentials) {
                if (!credentials?.otpToken) return null;
                try {
                    const payload = jwt.verify(
                        credentials.otpToken,
                        process.env.NEXTAUTH_SECRET as string
                    ) as { userId: number };
                    const user = await PrismaClient.user.findUnique({
                        where: { id: payload.userId },
                    });
                    if (!user) return null;
                    return {
                        id: String(user.id),
                        name: user.name ?? user.number,
                        email: user.email ?? undefined,
                    };
                } catch (error) {
                    return null;
                }
            },
        }),
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