export const test = (event: any, context: any, callback: any) => {
    console.log(event);

    callback(undefined, {
        statusCode: 200,
        body: JSON.stringify({'test': 'testvalue'})
    });
}
