import type {Metadata} from "next";
import type {ReactNode} from "react";
import "./globals.css";
export const metadata:Metadata={title:"企业内部应用市场",description:"企业 Web 应用发现平台"};
export default function RootLayout({children}:Readonly<{children:ReactNode}>){
 return <html lang="zh-CN"><body>{children}</body></html>;
}
