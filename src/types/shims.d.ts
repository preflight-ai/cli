declare module "dotenv";
declare module "ora";
declare module "commander";
declare module "execa";
declare module "prompts";
declare module "chalk";
declare module "./modules/*";
declare module "fs" {
  const anyExport: any;
  export = anyExport;
}
declare module "path" {
  const anyExport: any;
  export = anyExport;
}
declare module "os" {
  const anyExport: any;
  export = anyExport;
}
declare module "crypto" {
  const anyExport: any;
  export = anyExport;
}

declare const process: any;
