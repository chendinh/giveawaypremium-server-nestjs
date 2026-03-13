export class Consignment extends Parse.Object {
  constructor() {
    super('Consignment');
  }

  public getConsigner(): Parse.User {
    return this.get('consigner');
  }
}

Parse.Object.registerSubclass('Consignment', Consignment);
